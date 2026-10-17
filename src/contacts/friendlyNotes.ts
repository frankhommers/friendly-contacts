/**
 * Contact notes with friendly properties: reading them as the legacy record the UI uses,
 * rendering new notes, and naming them. Pure; the Obsidian side is in obsidianNotes.ts.
 */

import { parseCard, serializeLine, splitStructured, unescapeText } from 'src/contacts/friendly/lines';
import { DEFAULT_MAPPING, isMappedProperty, MappingRow, rowForLine, rowForProperty } from 'src/contacts/friendly/mapping';
import { coerceNoteProps } from 'src/contacts/friendly/merge';
import { RelationContext } from 'src/contacts/friendly/relations';
import { FriendlyValue, newCard, toFriendly } from 'src/contacts/friendly/translate';
import { renderFrontmatter } from 'src/contacts/frontmatterYaml';
import { parseKey, ParsedKey } from 'src/contacts/contactDataKeys';
import { parseRecord } from 'src/contacts/vcard/parse';
import { recordToVCard } from 'src/contacts/vcard/recordToVCard';
import { VCardForObsidianRecord, VCardSupportedKey } from 'src/contacts/vcard/shared/vcard.d';
import { StructuredFields } from 'src/contacts/vcard/shared/structuredFields';
import { createNameSlug } from 'src/util/nameUtils';

/** The legacy record has no relations, so links never need resolving here. */
const NO_RELATIONS: RelationContext = {
  uidToName: () => undefined,
  resolveLink: (name) => ({ text: name }),
};

function tryParseKey(key: string): ParsedKey | undefined {
  try {
    return parseKey(key);
  } catch {
    return undefined;
  }
}

/** `FN`, `TEL[CELL]`, `ADR[HOME].STREET`, `X-FOO`: a key of an old-style (upstream) note. */
export function isVCardKey(key: string): boolean {
  const parsed = tryParseKey(key);
  if (!parsed) return false;
  return Object.prototype.hasOwnProperty.call(VCardSupportedKey, parsed.key) || parsed.key.startsWith('X-');
}

export const hasValue = (value: unknown): boolean =>
  Array.isArray(value) ? value.some(hasValue) : value !== undefined && value !== null && String(value).trim() !== '';

/**
 * The note still holds data under vCard keys (`FN`, `UID`, `TEL[CELL]`, `X-...`): an upstream note, or one
 * half converted. Sync does not read those keys, so such a note must be converted first.
 */
export function hasVCardValues(frontmatter: Record<string, unknown>): boolean {
  return Object.entries(frontmatter).some(([key, value]) => isVCardKey(key) && hasValue(value));
}

export function isContactFrontmatter(frontmatter: Record<string, unknown> | undefined | null): boolean {
  if (!frontmatter) return false;
  const fm = frontmatter;
  return Boolean(fm.name || fm.firstname || fm.lastname || fm.FN || (fm['N.GN'] && fm['N.FN']));
}

/**
 * The `TEL[CELL]`-style record the sidebar, menus and avatar work with.
 * vCard keys in the note pass through unchanged; friendly properties are turned into a card and read back
 * with the upstream parser. A note without `uid` gives a record without `UID`.
 */
export function legacyRecord(frontmatter: Record<string, unknown>, rows: MappingRow[]): VCardForObsidianRecord {
  const passThrough = Object.fromEntries(
    Object.entries(frontmatter).filter(([key]) => isVCardKey(key)),
  ) as VCardForObsidianRecord;
  const { props } = coerceNoteProps(frontmatter, rows);
  if (Object.keys(props).length === 0) return passThrough;

  let lines = newCard(props, rows, NO_RELATIONS).lines;
  // newCard invents a UID for a card without one; the record must show that the note has none.
  if (props.uid === undefined) lines = lines.filter((line) => line.group !== undefined || line.name !== 'UID');
  const record = parseRecord(lines.map(serializeLine).join('\n') + '\n');
  for (const [key, value] of Object.entries(record)) {
    if (key.startsWith('PHOTO')) continue;
    // ORG is `name;unit`; the record (like upstream's sidebar) shows the organisation name.
    record[key] = unescapeText(key === 'ORG' ? splitStructured(value)[0] : value);
  }
  // A vCard 3 photo (ENCODING=b) arrives as bare base64; the avatar needs a URI.
  if (record.PHOTO && !record.PHOTO.includes(':')) record.PHOTO = `data:image/jpeg;base64,${record.PHOTO}`;
  return { ...record, ...passThrough };
}

/** An old-style record (vCard keys) -> friendly properties, through the card it describes. */
export function recordToFriendly(
  record: Record<string, string>,
  rows: MappingRow[],
): Record<string, FriendlyValue> {
  return toFriendly(parseCard(recordToVCard(record, '')), rows, NO_RELATIONS).props;
}

/** `UID` -> `uid`, `TEL[CELL]` -> `mobile`, `N.GN` -> `firstname`; keys without a row stay as they are. */
export function friendlyKey(vcardKey: string, rows: MappingRow[]): string {
  if (isMappedProperty(vcardKey, rows)) return vcardKey;
  const parsed = tryParseKey(vcardKey);
  if (!parsed) return vcardKey;
  const name = parsed.key.toUpperCase();
  const params: [string, string][] = parsed.type ? [['TYPE', parsed.type]] : [];
  const matching = rowForLine({ name, params, value: '' }, rows);
  if (matching.length === 0) return vcardKey;
  if (matching[0].kind !== 'component') return matching[0].property;
  const fields: readonly string[] | undefined = StructuredFields[name as keyof typeof StructuredFields];
  const index = parsed.subkey && fields ? fields.indexOf(parsed.subkey.toUpperCase()) : 0;
  const row = matching.find((r) => r.kind === 'component' && r.index === index);
  return row ? row.property : vcardKey;
}

/** The property holding the vCard UID (last in a rendered note). */
function uidProperty(rows: MappingRow[]): string {
  return rows.find((row) => row.kind === 'field' && row.write === 'UID')?.property ?? 'uid';
}

/** A new contact note: frontmatter in mapping-row order, `uid` last; body is an empty line plus hashtags. */
export function renderFriendlyNote(
  props: Record<string, FriendlyValue>,
  hashtags: string,
  rows: MappingRow[] = DEFAULT_MAPPING,
): string {
  const uid = uidProperty(rows);
  const rank = (key: string): [number, number] => {
    if (key === uid) return [rows.length + 1, 0];
    const found = rowForProperty(key, rows);
    return found ? [rows.indexOf(found.row), found.ordinal] : [rows.length, 0];
  };
  const entries = Object.entries(props).sort(([a], [b]) => {
    const [ra, oa] = rank(a);
    const [rb, ob] = rank(b);
    return ra - rb || oa - ob;
  });
  const tags = hashtags.trim();
  return `${renderFrontmatter(entries)}\n${tags === '' ? '' : `${tags}\n`}`;
}

/**
 * File name (without `.md`) a card gets on import, from its N and FN values as on the wire:
 * the N parts for a person, else FN. Undefined when the card has no name.
 */
export function contactFileName(n: string | undefined, fn: string | undefined): string | undefined {
  const parts = n ? splitStructured(n).map(unescapeText) : [];
  const record: Record<string, string | undefined> = {
    'N.FN': parts[0],
    'N.GN': parts[1],
    'N.MN': parts[2],
    'N.PREFIX': parts[3],
    'N.SUFFIX': parts[4],
    FN: fn ? unescapeText(fn) : undefined,
  };
  try {
    return createNameSlug(record as VCardForObsidianRecord) || undefined;
  } catch {
    return undefined;
  }
}

/** A `.vcf` file with several cards -> one text per card, each starting at its `BEGIN:VCARD`. */
export function splitCards(text: string): string[] {
  const starts = [...text.matchAll(/^BEGIN:VCARD/gim)].map((m) => m.index ?? 0);
  return starts.map((start, i) => text.slice(start, starts[i + 1] ?? text.length));
}
