/**
 * Friendly note properties -> vCard lines. Starts from the server's lines and
 * changes only what the user changed; every other line stays the same object.
 * No obsidian / src/context imports.
 */

import { cleanUid, generateUUID } from '../../util/vcard';
import { normalizeNoteDate, writeDate } from './dates';
import { escapeText, getParam, joinStructured, serializeLine, splitStructured, typesOf, VCardLine } from './lines';
import { photoKey, photoLine } from './photo';
import { ComponentRow, FieldRow, MappingRow, RelationRow, rowForLine, rowForProperty, writeLabel } from './mapping';
import { HINT_PARAM, linkTarget, RelationContext, relationValue } from './relations';
import type { Friendly, FriendlyValue, Provenance } from './translate';

export interface PatchResult {
  lines: VCardLine[];
  warnings: string[];
}

export interface PatchOptions {
  /** Put right the relationship lines the plugin wrote that phones show wrongly (see `needsLegacyRewrite`). */
  rewriteLegacyRelations?: boolean;
}

/** Component count of structured values we may have to create from scratch. */
const COMPONENT_COUNT: Record<string, number> = { ADR: 7, N: 5, ORG: 2 };

/** Shared bookkeeping; line indexes refer to `base`, deletions apply at the end. */
interface State {
  base: VCardLine[];
  lines: VCardLine[];
  removed: Set<number>;
  /** New lines placed right after a line of `base` (the 3.0 form of a rewritten `RELATED` line). */
  after: Map<number, VCardLine[]>;
  added: VCardLine[];
  /** Escaped components of existing structured lines being edited. */
  parts: Map<number, string[]>;
  /** New structured lines (already in `added`) per write key, with their escaped components. */
  newParts: Map<string, { line: VCardLine; parts: string[] }>;
  warnings: string[];
  changed: boolean;
}

/** Frontmatter may hold numbers, nulls or lists where text is expected. */
function text(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.map(text).filter((s) => s !== '').join(', ');
  return String(value).trim();
}

function list(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]).map(text).filter((s) => s !== '');
}

function sameSet(a: string[], b: string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === sb.size && [...sa].every((x) => sb.has(x));
}

/** `TEL;TYPE=CELL` -> name + params. */
function parseWriteKey(write: string): { name: string; params: [string, string][] } {
  const [name, ...params] = write.split(';');
  return {
    name: name.trim().toUpperCase(),
    params: params
      .filter((p) => p !== '')
      .map((p): [string, string] => {
        const eq = p.indexOf('=');
        return eq < 0 ? ['TYPE', p] : [p.slice(0, eq).toUpperCase(), p.slice(eq + 1)];
      }),
  };
}

/** Copy of `line` with a new value (and optionally params), without `raw`. */
function withValue(line: VCardLine, value: string, params = line.params): VCardLine {
  const { raw: _raw, ...rest } = line;
  return { ...rest, params: params.map(([k, v]): [string, string] => [k, v]), value };
}

function single(prov: Provenance | Provenance[] | undefined): Provenance | undefined {
  return Array.isArray(prov) ? undefined : prov;
}

function setLine(s: State, index: number, line: VCardLine): void {
  s.lines[index] = line;
  s.changed = true;
}

/** New label lines are spelled as Apple and DAVx5 write them; parsed ones are upper-case. */
const isLabel = (line: VCardLine): boolean => line.name.toUpperCase() === 'X-ABLABEL';

/** Deletes a line and the Apple label sharing its group. */
function removeLine(s: State, index: number): void {
  s.removed.add(index);
  s.changed = true;
  const group = s.base[index].group?.toLowerCase();
  if (group === undefined) return;
  s.base.forEach((line, i) => {
    if (isLabel(line) && line.group?.toLowerCase() === group) s.removed.add(i);
  });
}

/**
 * The next free `itemN` group: above every item number on the card (removed lines included), so it never matches an
 * existing group in any case. The lines it is for must be added before the next one is asked for.
 */
function newGroup(s: State): string {
  const all = [...s.base, ...s.lines, ...s.added, ...[...s.after.values()].flat()];
  let max = 0;
  for (const line of all) {
    const n = /^item(\d+)$/i.exec(line.group ?? '');
    if (n) max = Math.max(max, Number(n[1]));
  }
  return `item${max + 1}`;
}

/** A labelled group: `itemN.<name>` plus `itemN.X-ABLabel`, the way vCard 3.0 cards hold relationships and dates. */
function labelled(s: State, name: string, params: [string, string][], value: string, label: string): VCardLine[] {
  const group = newGroup(s);
  return [
    { group, name, params, value },
    { group, name: 'X-ABLabel', params: [], value: escapeText(writeLabel(label)) },
  ];
}

function addLine(s: State, write: string, value: string, extraParams: [string, string][] = []): VCardLine {
  const key = parseWriteKey(write);
  const line: VCardLine = { name: key.name, params: [...key.params, ...extraParams], value };
  s.added.push(line);
  s.changed = true;
  return line;
}

function setPart(parts: string[], index: number, value: string): void {
  while (parts.length <= index) parts.push('');
  parts[index] = value;
}

/** `firstname lastname`, trimmed; empty when both are empty. */
function derivedName(props: Record<string, FriendlyValue>): string {
  return [props.firstname, props.lastname]
    .map(text)
    .filter((s) => s !== '')
    .join(' ');
}

/** A date in the form the card's version and the line's own style expect; a same-date edit leaves the line alone. */
function patchDate(s: State, row: FieldRow, prov: Provenance | undefined, before: string, after: string): void {
  if (normalizeNoteDate(before) === normalizeNoteDate(after)) return;
  if (normalizeNoteDate(after) === '') {
    if (prov) removeLine(s, prov.line);
    return;
  }
  const line = prov ? s.base[prov.line] : undefined;
  const written = writeDate(after, line, cardVersion(s));
  if (!line) {
    // vCard 3.0 has no ANNIVERSARY: Apple and DAVx5 write a labelled X-ABDATE. Existing lines keep their form.
    if (row.appleDateLabel !== undefined && !isV4(s)) {
      s.added.push(...labelled(s, 'X-ABDATE', written.params, written.value, row.appleDateLabel));
      s.changed = true;
    } else addLine(s, row.write, written.value, written.params);
    return;
  }
  const next = withValue(line, written.value, written.params);
  if (!sameLine(next, line)) setLine(s, prov!.line, next);
}

/** Params as comparable text: names upper-case, values unquoted and lower-case, in a fixed order. */
function paramKeys(line: VCardLine): string[] {
  return line.params.map(([k, v]) => `${k.toUpperCase()}=${v.replace(/^"(.*)"$/, '$1').toLowerCase()}`).sort();
}

/**
 * Same group, name, params and value. Compared structurally, not by serializing: an untouched line serializes
 * as its raw text, which may spell names and params in lower case or quoted.
 */
function sameLine(a: VCardLine, b: VCardLine): boolean {
  const pa = paramKeys(a);
  const pb = paramKeys(b);
  return (
    (a.group ?? '').toLowerCase() === (b.group ?? '').toLowerCase() &&
    a.name.toUpperCase() === b.name.toUpperCase() &&
    a.value === b.value &&
    pa.length === pb.length &&
    pa.every((k, i) => k === pb[i])
  );
}

function patchField(
  s: State,
  row: FieldRow,
  prov: Provenance | undefined,
  before: unknown,
  after: unknown,
  props: Record<string, FriendlyValue>,
): void {
  if (row.format === 'date') return patchDate(s, row, prov, text(before), text(after));
  const isList = row.format === 'list';
  if (isList ? sameSet(list(before), list(after)) : text(before) === text(after)) return;
  if (row.property === 'photo') return patchPhoto(s, row, prov, text(before), text(after));
  let value: string;
  if (isList) value = list(after).map(escapeText).join(',');
  else if (row.property === 'photo') value = text(after);
  else value = escapeText(text(after));

  // The UID and FN lines are never deleted: an emptied FN falls back to the name parts, else stays as it is.
  if (prov && value === '' && row.property === 'name') value = escapeText(derivedName(props));
  if (prov && value === '' && (row.property === 'uid' || row.property === 'name')) return;

  if (prov) {
    if (value === '') removeLine(s, prov.line);
    else if (value !== s.base[prov.line].value) setLine(s, prov.line, withValue(s.base[prov.line], value));
  } else if (value !== '') {
    addLine(s, row.write, value);
  }
}

/** VERSION of a card; 3.0 when absent, as Apple writes. */
function versionOf(lines: VCardLine[]): string {
  return lines.find((line) => !line.group && line.name === 'VERSION')?.value ?? '3.0';
}

/** VERSION of the card being patched (newCard starts with the version it is given). */
function cardVersion(s: State): string {
  return versionOf(s.base);
}

const isV4 = (s: State): boolean => cardVersion(s).trim() === '4.0';

/** PHOTO in the form the card's version expects; an edit keeps the group and drops the other params. */
function patchPhoto(s: State, row: FieldRow, prov: Provenance | undefined, before: string, after: string): void {
  if (after !== '' && photoKey(before) === photoKey(after)) return;
  if (after === '') {
    if (prov) removeLine(s, prov.line);
    return;
  }
  const photo = photoLine(after, cardVersion(s));
  if (!prov) {
    if (photo) {
      s.added.push({ name: 'PHOTO', params: photo.params, value: photo.value });
      s.changed = true;
    } else addLine(s, row.write, after);
    return;
  }
  const line = s.base[prov.line];
  const next = photo ? withValue(line, photo.value, photo.params) : withValue(line, after);
  if (serializeLine(next) !== serializeLine(line)) setLine(s, prov.line, next);
}

function patchComponent(
  s: State,
  row: ComponentRow,
  prov: Provenance | undefined,
  before: unknown,
  after: unknown,
  rows: MappingRow[],
): void {
  if (text(before) === text(after)) return;
  const value = escapeText(text(after));
  // An empty component has no provenance; its line is the first one feeding this row (as in toFriendly).
  const index = prov?.line ?? s.base.findIndex((line) => rowForLine(line, rows).includes(row));
  if (index >= 0) {
    const parts = s.parts.get(index) ?? splitStructured(s.base[index].value);
    setPart(parts, row.index, value);
    s.parts.set(index, parts);
    return;
  }
  if (value === '') return;
  let pending = s.newParts.get(row.write);
  if (!pending) {
    const parts: string[] = Array(COMPONENT_COUNT[parseWriteKey(row.write).name] ?? 0).fill('');
    pending = { line: addLine(s, row.write, ''), parts };
    s.newParts.set(row.write, pending);
  }
  setPart(pending.parts, row.index, value);
}

function finishComponents(s: State): void {
  for (const [index, parts] of s.parts) {
    const line = s.base[index];
    const value = joinStructured(parts);
    if (value === line.value) continue;
    if (line.name !== 'N' && parts.every((p) => p === '')) removeLine(s, index);
    else setLine(s, index, withValue(line, value));
  }
  for (const { line, parts } of s.newParts.values()) line.value = joinStructured(parts);
}

/** Who a relationship line is about: the name written on the card, and the contact's UID (clean) when known. */
type Person = { name: string; uid?: string };

/** The person for a link target: a contact's display name (never a path or alias) and UID, or plain text. */
function personFor(s: State, name: string, ctx: RelationContext): Person {
  const resolved = ctx.resolveLink(name);
  if ('uid' in resolved) {
    const uid = cleanUid(resolved.uid);
    const shown = ctx.displayName(uid)?.trim();
    return { uid, name: shown ? shown : name.slice(name.lastIndexOf('/') + 1) };
  }
  if ('text' in resolved) return { name: resolved.text !== '' ? resolved.text : name };
  s.warnings.push(`"${name}" matches more than one contact; saved as text.`);
  return { name };
}

/** The hint parameter for a person with a UID; quoted when the UID holds `:`, `;` or `,`. */
function hintParams(person: Person): [string, string][] {
  const uid = person.uid;
  if (uid === undefined || uid === '' || /["\r\n]/.test(uid)) return [];
  return [[HINT_PARAM, /[:;,]/.test(uid) ? `"${uid}"` : uid]];
}

/**
 * New lines for a relationship in the card's own form: on vCard 3.0 a labelled `X-ABRELATEDNAMES` group, on 4.0
 * `RELATED` as text. A row without a label (it could not be read back from 3.0) is written as on 4.0.
 */
function relationLines(s: State, row: RelationRow, person: Person): VCardLine[] {
  const label = (row.labels ?? [])[0];
  const value = escapeText(person.name);
  if (!isV4(s) && label !== undefined && label.trim() !== '') {
    return labelled(s, 'X-ABRELATEDNAMES', hintParams(person), value, label);
  }
  return [{ name: 'RELATED', params: [['TYPE', row.types[0]], ['VALUE', 'text'], ...hintParams(person)], value }];
}

const target = (value: string): string => linkTarget(value).trim();

function addRelated(s: State, row: RelationRow, name: string, ctx: RelationContext): void {
  s.added.push(...relationLines(s, row, personFor(s, name, ctx)));
  s.changed = true;
}

/** An existing relationship line pointed at someone else, in place: group, label and other params stay. */
function replaceRelated(s: State, index: number, person: Person): void {
  const line = s.lines[index];
  const names = line.name === 'X-ABRELATEDNAMES';
  const params = line.params.filter(([k]) => k !== HINT_PARAM && (names || k !== 'VALUE'));
  // X-ABRELATEDNAMES always holds a name; RELATED gets the vCard 4.0 text form.
  if (!names) params.push(['VALUE', 'text']);
  params.push(...hintParams(person));
  setLine(s, index, withValue(line, escapeText(person.name), params));
}

function patchRelation(
  s: State,
  row: RelationRow,
  key: string,
  prov: Provenance | Provenance[] | undefined,
  before: unknown,
  after: unknown,
  ctx: RelationContext,
): void {
  if (row.single) {
    if (Array.isArray(after) && after.length > 1) {
      s.warnings.push(`"${key}" holds a list; only its first item is used.`);
    }
    const name = target(text(Array.isArray(after) ? after[0] : after));
    if (target(text(before)) === name) return;
    const p = single(prov);
    if (name === '') {
      if (p) removeLine(s, p.line);
    } else if (p) {
      replaceRelated(s, p.line, personFor(s, name, ctx));
    } else {
      addRelated(s, row, name, ctx);
    }
    return;
  }

  const beforeNames = list(before).map(target);
  const afterNames = list(after).map(target).filter((n) => n !== '');
  if (sameSet(beforeNames, afterNames)) return;
  const provs = Array.isArray(prov) ? prov : [];
  beforeNames.forEach((name, i) => {
    if (!afterNames.includes(name) && provs[i]) removeLine(s, provs[i].line);
  });
  for (const name of new Set(afterNames)) {
    if (!beforeNames.includes(name)) addRelated(s, row, name, ctx);
  }
}

const unquote = (value: string): string => value.replace(/^"(.*)"$/, '$1').trim();

/** How a relationship line the plugin wrote is put right: in the 3.0 form for `row`, or in place (`row` absent). */
type LegacyFix = { person: Person; row?: RelationRow };

/**
 * What Apply does with a relationship line the plugin wrote, undefined when nothing (or nothing it can do):
 * - a `RELATED` line on a 3.0 card (a `urn:uuid:` value, or a name with the hint) becomes the 3.0 form of the row
 *   its type maps to (it needs a label);
 * - a name that is a `urn:uuid:` (a phone kept the plugin's old link as the name), and a hinted name the contact no
 *   longer has (renamed), get the contact's display name and the hint in place, whatever the version.
 * The hint wins when it names a contact, as in the reader. Lines another app wrote (a name without the hint, a
 * `RELATED` line with several types) are left alone, and so is a `urn:uuid:` value on a 4.0 card (its own form).
 * `edited`: the line was just written by this patch (a name without the hint when the person is ambiguous).
 */
function legacyFix(line: VCardLine, v4: boolean, rows: MappingRow[], ctx: RelationContext, edited = false): LegacyFix | undefined {
  if (line.name !== 'RELATED' && line.name !== 'X-ABRELATEDNAMES') return undefined;
  if (line.name === 'RELATED' && typesOf(line).length > 1) return undefined;
  const hint = cleanUid(unquote(getParam(line, HINT_PARAM) ?? ''));
  const value = relationValue(line);
  let person: Person | undefined;
  if ('uid' in value) {
    for (const uid of [hint, cleanUid(value.uid)]) {
      const name = uid === '' ? undefined : ctx.displayName(uid)?.trim();
      if (name) {
        person = { name, uid };
        break;
      }
    }
  } else if (hint !== '' && value.name !== '') {
    // The contact's current name beats the text the card was last written with.
    person = { name: ctx.displayName(hint)?.trim() || value.name, uid: hint };
  } else if (edited && value.name !== '') {
    person = { name: value.name };
  }
  if (!person) return undefined;
  if (!v4 && line.name === 'RELATED') {
    const row = rowForLine(line, rows)[0];
    if (row?.kind === 'relation' && ((row.labels ?? [])[0] ?? '').trim() !== '') return { person, row };
  }
  const shown = 'name' in value ? value.name : value.asName ? undefined : person.name;
  return shown !== person.name ? { person } : undefined;
}

/**
 * True when the card holds relationship lines the plugin wrote that phones show wrongly: `RELATED` on a 3.0 card
 * (a code, or nothing), a "urn:uuid:…" name, or an old name of a renamed contact. Only the lines
 * `patch(…, { rewriteLegacyRelations: true })` can rewrite count (decided with the same mapping and contacts): a line
 * it cannot rewrite stays as it is, and must not ask for a rewrite again and again.
 */
export function needsLegacyRewrite(lines: VCardLine[], rows: MappingRow[], ctx: RelationContext): boolean {
  const v4 = versionOf(lines).trim() === '4.0';
  return lines.some((line) => legacyFix(line, v4, rows, ctx) !== undefined);
}

/** Every relationship line `legacyFix` names (on the card as edited here) is put right, where it was. */
function rewriteLegacy(s: State, rows: MappingRow[], ctx: RelationContext): void {
  const v4 = isV4(s);
  s.base.forEach((_, i) => {
    if (s.removed.has(i)) return;
    const fix = legacyFix(s.lines[i], v4, rows, ctx, s.lines[i] !== s.base[i]);
    if (!fix) return;
    if (fix.row) {
      removeLine(s, i);
      s.after.set(i, relationLines(s, fix.row, fix.person));
    } else replaceRelated(s, i, fix.person);
  });
}

/** Current UTC time as `YYYYMMDDTHHMMSSZ`. */
function revStamp(): string {
  return new Date().toISOString().replace(/\.\d{3}/, '').replace(/[-:]/g, '');
}

/** Mapped properties of both sides, in mapping-table order. */
function mappedKeys(
  before: Record<string, FriendlyValue>,
  after: Record<string, FriendlyValue>,
  rows: MappingRow[],
): { key: string; row: MappingRow; ordinal: number }[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys]
    .flatMap((key) => {
      const found = rowForProperty(key, rows);
      return found ? [{ key, ...found }] : [];
    })
    .sort((a, b) => rows.indexOf(a.row) - rows.indexOf(b.row) || a.ordinal - b.ordinal);
}

export function patch(
  base: VCardLine[],
  before: Friendly,
  after: Record<string, FriendlyValue>,
  rows: MappingRow[],
  ctx: RelationContext,
  opts: PatchOptions = {},
): PatchResult {
  const s: State = {
    base,
    lines: base.slice(),
    removed: new Set(),
    after: new Map(),
    added: [],
    parts: new Map(),
    newParts: new Map(),
    warnings: [],
    changed: false,
  };

  for (const { key, row, ordinal } of mappedKeys(before.props, after, rows)) {
    const prov = before.source[key];
    const was = before.props[key];
    const now = after[key];
    if (row.kind === 'field') patchField(s, row, single(prov), was, now, after);
    // toFriendly never numbers component rows or list relations; such keys have no line to map to.
    else if (ordinal > 1 && !(row.kind === 'relation' && row.single)) continue;
    else if (row.kind === 'component') patchComponent(s, row, single(prov), was, now, rows);
    else patchRelation(s, row, key, prov, was, now, ctx);
  }
  finishComponents(s);
  if (opts.rewriteLegacyRelations) rewriteLegacy(s, rows, ctx);

  if (s.changed) {
    const rev = base.findIndex((line, i) => line.name === 'REV' && !s.removed.has(i));
    if (rev >= 0) setLine(s, rev, withValue(base[rev], revStamp()));
  }

  const lines = s.lines.flatMap((line, i) => [...(s.removed.has(i) ? [] : [line]), ...(s.after.get(i) ?? [])]);
  return { lines: [...lines, ...s.added], warnings: s.warnings };
}

/** A fresh card from friendly properties, every property in the form `version` uses (4.0 unless asked otherwise). */
export function newCard(
  props: Record<string, FriendlyValue>,
  rows: MappingRow[],
  ctx: RelationContext,
  version: '3.0' | '4.0' = '4.0',
): PatchResult {
  const base: VCardLine[] = [{ name: 'VERSION', params: [], value: version }];
  if (text(props.uid) === '') base.push({ name: 'UID', params: [], value: `urn:uuid:${generateUUID()}` });
  if (text(props.name) === '') {
    const fn = derivedName(props);
    if (fn !== '') base.push({ name: 'FN', params: [], value: escapeText(fn) });
  }
  return patch(base, { props: {}, source: {} }, props, rows, ctx);
}
