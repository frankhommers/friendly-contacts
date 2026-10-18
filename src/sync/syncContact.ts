/**
 * One lossless Sync of a contact note with its CardDAV card.
 *
 * Three-way merge of the last synced card (base), the server card and the note;
 * the note gets only the properties that changed, the server card is patched line
 * by line and written with If-Match. Nothing from obsidian or src/context: the
 * note, the server and the base store all come in through `deps`.
 */

import { parseCard, serializeCard } from 'src/contacts/friendly/lines';
import { isMappedProperty, MappingRow, rowForProperty } from 'src/contacts/friendly/mapping';
import {
  alignNoteDates,
  Conflict,
  coerceNoteProps,
  mergeFriendly,
  renderConflictCallout,
  sameValue,
} from 'src/contacts/friendly/merge';
import { linkTarget, RelationContext, toLink } from 'src/contacts/friendly/relations';
import { FriendlyValue, newCard, patch, toFriendly } from 'src/contacts/friendly/translate';
import type { VCardMeta, VCardRaw } from 'src/sync/adapters/adapter';
import type { AdapterInterface } from 'src/sync/adapters/adapterInterface';
import type { CardLocation } from 'src/sync/sources';
import type { SyncState, SyncStateEntry } from 'src/sync/syncState';
import type { AppHttpResponse } from 'src/util/platformHttpClient';
import { cleanUid, generateUUID } from 'src/util/vcard';

export interface NoteIO {
  readFrontmatter(): Promise<Record<string, unknown>>;
  writeProps(set: Record<string, FriendlyValue>, remove: string[]): Promise<void>;
  appendToBody(markdown: string): Promise<void>;
}

export interface SyncDeps {
  adapter: AdapterInterface;
  state: SyncState;
  rows: MappingRow[];
  ctx: RelationContext;
  notify(msg: string): void;
  now(): Date;
}

export type SyncOutcome = 'unchanged' | 'pulled' | 'pushed' | 'both' | 'created' | 'failed';

type Props = Record<string, FriendlyValue>;

/** The card changed on the server between our GET and our PUT (412); start over once. */
type Attempt = SyncOutcome | 'retry';

/** A server or card problem; ends the sync as `failed` before anything is written. */
class SyncError extends Error {}

const isResponse = (value: unknown): value is AppHttpResponse =>
  typeof value === 'object' && value !== null && 'status' in value && 'errorMessage' in value;

export const describeResponse = (res: AppHttpResponse): string => res.errorMessage || `HTTP ${res.status}`;

export const succeeded = (res: AppHttpResponse): boolean => !res.errorMessage && res.status >= 200 && res.status < 300;

const cardUid = (raw: string): string => cleanUid(parseCard(raw).find((l) => !l.group && l.name === 'UID')?.value);

export async function syncContact(note: NoteIO, deps: SyncDeps): Promise<SyncOutcome> {
  try {
    const { props: coerced, warnings } = coerceNoteProps(await note.readFrontmatter(), deps.rows);
    for (const warning of warnings) deps.notify(warning);
    const local: Props = Object.fromEntries(Object.entries(coerced).filter(([p]) => !isUnrepresentable(p, deps.rows)));

    let uid = typeof local.uid === 'string' ? local.uid.trim() : '';
    let lookup = true;
    if (uid === '') {
      uid = `urn:uuid:${generateUUID()}`;
      await note.writeProps({ uid }, []);
      local.uid = uid;
      lookup = false;
    }

    for (let attempt = 1; attempt <= 2; attempt++) {
      const result = await syncOnce(note, deps, local, uid, lookup || attempt > 1);
      if (result !== 'retry') return result;
    }
    deps.notify('Sync failed: the card keeps changing on the server (412 Precondition Failed). Try again.');
    return 'failed';
  } catch (e) {
    deps.notify(`Sync failed: ${e instanceof Error ? e.message : String(e)}`);
    return 'failed';
  }
}

async function syncOnce(note: NoteIO, deps: SyncDeps, local: Props, uid: string, lookup: boolean): Promise<Attempt> {
  const meta = lookup ? await findCard(deps.adapter, uid) : undefined;
  const base = await deps.state.get(uid);
  if (!meta) {
    // A synced card that is gone (deleted, or not found by the lookup) is never silently recreated as a duplicate.
    if (base) throw new SyncError(`${typeof local.name === 'string' ? local.name : uid} was not found on the server.`);
    return createCard(note, deps, local, uid);
  }

  const server = await pullCard(deps.adapter, meta.href, uid);
  const serverLines = parseCard(server.raw);
  const serverFriendly = toFriendly(serverLines, deps.rows, deps.ctx);
  const baseLines = base ? parseCard(base.raw) : undefined;
  const baseCard = baseLines && { lines: baseLines, friendly: toFriendly(baseLines, deps.rows, deps.ctx) };
  const baseProps = baseCard?.friendly.props;

  // `urn:uuid:X` in the note and `X` on the server are the same UID (checked by pullCard); keep the server's spelling.
  const mine: Props = { ...local };
  if (serverFriendly.props.uid !== undefined) mine.uid = serverFriendly.props.uid;

  // A legacy Apple `1604-03-12` in the note is the cards' `--03-12`: no edit for the merge. `mine` keeps the
  // note's own value, so writeNote still moves the note to `--03-12`.
  const aligned = alignNoteDates(mine, deps.rows, [baseCard, { lines: serverLines, friendly: serverFriendly }]);
  const { merged, conflicts } = mergeFriendly(baseProps, serverFriendly.props, canonicalRelations(aligned, deps));
  const patched = patch(serverLines, serverFriendly, merged, deps.rows, deps.ctx);
  const raw = serializeCard(patched.lines);
  const etag = server.etag || meta.etag;

  let stored: SyncStateEntry = { raw: server.raw, etag, href: meta.href };
  // Without a base the merge keeps the server card as it is; never PUT on a guess.
  const serverChanged = baseProps !== undefined && raw !== serializeCard(serverLines);
  if (serverChanged) {
    if (!etag) throw new SyncError(`the server sent no ETag for ${meta.href}; not writing without If-Match.`);
    const res = await deps.adapter.push({ uid: cleanUid(uid), raw }, { href: meta.href, ifMatch: etag });
    if (res.status === 412) return 'retry';
    if (!succeeded(res)) throw new SyncError(describeResponse(res));
    // Without an ETag in the response the base keeps etag ''; the base etag is never used for If-Match.
    stored = { raw, etag: responseEtag(res), href: meta.href };
  }

  // The note takes the card as it now is on the server, so numbering (`mobile-2` -> `mobile`) and link text
  // are canonical and the next Sync finds nothing to do.
  const final = serverChanged ? toFriendly(patched.lines, deps.rows, deps.ctx).props : serverFriendly.props;
  const noteChanged = await writeNote(note, deps, mine, final, conflicts);
  for (const warning of patched.warnings) deps.notify(warning);
  await deps.state.set(uid, stored);
  if (serverChanged) return noteChanged ? 'both' : 'pushed';
  return noteChanged ? 'pulled' : 'unchanged';
}

/**
 * Relation links as the card would show them: a link that resolves to a known contact becomes `[[<its name>]]`,
 * so `[[06 People/Sem de Vries]]` and the server's `[[Sem de Vries]]` are not seen as a change.
 */
function canonicalRelations(props: Props, deps: SyncDeps): Props {
  const canonical = (item: string): string => {
    const resolved = deps.ctx.resolveLink(linkTarget(item.trim()));
    const name = 'uid' in resolved ? deps.ctx.uidToName(resolved.uid) : undefined;
    return name !== undefined && name !== '' ? toLink(name) : item;
  };
  const result: Props = { ...props };
  for (const [property, value] of Object.entries(props)) {
    if (rowForProperty(property, deps.rows)?.row.kind !== 'relation') continue;
    result[property] = Array.isArray(value) ? value.map(canonical) : canonical(value);
  }
  return result;
}

/**
 * Note keys no card line can hold (`street-2`, `children-2`: component rows and list relations are never
 * numbered). Sync treats them like local-only properties: never pushed, never removed.
 */
function isUnrepresentable(property: string, rows: MappingRow[]): boolean {
  const found = rowForProperty(property, rows);
  if (!found || found.ordinal < 2) return false;
  return found.row.kind === 'component' || (found.row.kind === 'relation' && !found.row.single);
}

/** No card on the server: create one from the note; never overwrites (If-None-Match). */
async function createCard(note: NoteIO, deps: SyncDeps, local: Props, uid: string): Promise<Attempt> {
  const card = newCard(local, deps.rows, deps.ctx);
  const raw = serializeCard(card.lines);
  const id = cleanUid(uid);
  const res = await deps.adapter.push({ uid: id, raw }, { ifNoneMatch: true });
  if (res.status === 412) return 'retry';
  if (!succeeded(res)) throw new SyncError(describeResponse(res));

  const stored = await createdBase(deps.adapter, id, raw, res);

  // Like after any sync, the note takes the card's canonical properties (e.g. `mobile-2` alone becomes `mobile`).
  await writeNote(note, deps, local, toFriendly(card.lines, deps.rows, deps.ctx).props, []);
  for (const warning of card.warnings) deps.notify(warning);
  await deps.state.set(uid, stored);
  return 'created';
}

/**
 * The base for a card just created with If-None-Match (`res` is the PUT's response). The server picks the href;
 * ask for it. The base must still be stored when that lookup fails.
 */
export async function createdBase(adapter: AdapterInterface, id: string, raw: string, res: AppHttpResponse): Promise<SyncStateEntry> {
  let meta: VCardMeta | undefined;
  try {
    const found = await adapter.getMetaByUid(id);
    meta = !isResponse(found) && found && sameUid(found, id) ? found : undefined;
  } catch {
    meta = undefined;
  }
  return { raw, etag: responseEtag(res) || meta?.etag || '', href: meta?.href ?? `${encodeURIComponent(id)}.vcf` };
}

/** getMetaByUid matches UIDs that merely contain ours; only an exact match is this contact's card. */
async function findCard(adapter: AdapterInterface, uid: string): Promise<VCardMeta | undefined> {
  const found = await adapter.getMetaByUid(cleanUid(uid));
  if (isResponse(found)) throw new SyncError(describeResponse(found));
  return found && sameUid(found, cleanUid(uid)) ? found : undefined;
}

/**
 * Looks the UID up in every given source with the same exact-UID match as Sync. `found` lists the sources that
 * hold the card; `failed` lists the sources whose lookup failed (their answer is unknown).
 */
export async function locateCard(
  sources: { sourceId: string; adapter: AdapterInterface }[],
  uid: string,
): Promise<{ found: CardLocation[]; failed: { sourceId: string; message: string }[] }> {
  const found: CardLocation[] = [];
  const failed: { sourceId: string; message: string }[] = [];
  const results = await Promise.all(
    sources.map(async ({ sourceId, adapter }) => {
      try {
        return { sourceId, meta: await findCard(adapter, uid) };
      } catch (e) {
        return { sourceId, error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
  for (const result of results) {
    if ('error' in result) failed.push({ sourceId: result.sourceId, message: result.error ?? '' });
    else if (result.meta) found.push({ sourceId: result.sourceId, href: result.meta.href, etag: result.meta.etag });
  }
  return { found, failed };
}

/** A missing UID in the lookup result is left to pullCard, which checks the card itself. */
const sameUid = (meta: VCardMeta, id: string): boolean => meta.uid === undefined || cleanUid(meta.uid) === id;

async function pullCard(adapter: AdapterInterface, href: string, uid: string): Promise<VCardRaw> {
  const card = await adapter.pull(href);
  if (isResponse(card)) throw new SyncError(describeResponse(card));
  if (!card || cardUid(card.raw) !== cleanUid(uid)) {
    throw new SyncError(`the server card at ${href} is not the card with UID ${cleanUid(uid)}.`);
  }
  return card;
}

const responseEtag = (res: AppHttpResponse): string => res.headers?.etag?.replace(/"/g, '') ?? '';

/**
 * Saves the user's conflicting values in a callout first, then makes the note's mapped properties equal to
 * `final` (the card's friendly properties), so a failed append never loses a value. Returns whether
 * properties changed.
 */
async function writeNote(
  note: NoteIO,
  deps: SyncDeps,
  local: Props,
  final: Props,
  conflicts: Conflict[],
): Promise<boolean> {
  const set: Props = {};
  for (const [property, value] of Object.entries(final)) {
    if (!sameValue(value, local[property], property)) set[property] = value;
  }
  const remove = Object.keys(local).filter((p) => !(p in final) && isMappedProperty(p, deps.rows));
  const changed = Object.keys(set).length > 0 || remove.length > 0;

  if (conflicts.length > 0) {
    await note.appendToBody(renderConflictCallout(conflicts, deps.now()));
    const names = conflicts.map((c) => c.property).join(', ');
    deps.notify(`Sync conflict: kept the server value for ${names}. Your value is noted at the end of the note.`);
  }
  if (changed) await note.writeProps(set, remove);
  return changed;
}
