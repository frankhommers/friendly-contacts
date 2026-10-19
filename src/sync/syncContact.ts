/**
 * One Sync of a contact note with its CardDAV card, in two phases.
 *
 * `prepareSync` reads the note (L), the base (B) and the server card (S) and returns either "up to date" or the
 * review rows; it writes nothing, except storing S as the base when everything is equal and no base exists.
 * `applySync` takes the result R built from the user's choices, checks nothing moved underneath, patches the card
 * line by line and writes it with If-Match, then writes the note and stores the base. Nothing from obsidian or
 * src/context: the note, the server and the base store all come in through `deps`.
 */

import { parseCard, serializeCard, VCardLine } from 'src/contacts/friendly/lines';
import { isMappedProperty, MappingRow, RESERVED_PROPERTY, rowForProperty } from 'src/contacts/friendly/mapping';
import { alignNoteDates, coerceNoteProps, sameValue } from 'src/contacts/friendly/merge';
import { linkTarget, RelationContext, toLink } from 'src/contacts/friendly/relations';
import { Friendly, FriendlyValue, newCard, patch, toFriendly } from 'src/contacts/friendly/translate';
import type { VCardMeta, VCardRaw } from 'src/sync/adapters/adapter';
import type { AdapterInterface } from 'src/sync/adapters/adapterInterface';
import { moveCard } from 'src/sync/moveCard';
import { isUpToDate, ReviewRow, reviewRows } from 'src/sync/review';
import type { CardLocation } from 'src/sync/sources';
import type { SyncState, SyncStateEntry } from 'src/sync/syncState';
import type { AppHttpResponse } from 'src/util/platformHttpClient';
import { cleanUid, generateUUID } from 'src/util/vcard';

export interface NoteIO {
  readFrontmatter(): Promise<Record<string, unknown>>;
  writeProps(set: Record<string, FriendlyValue>, remove: string[]): Promise<void>;
  /** Renames the note in its own folder; 'exists' (and nothing renamed) when that name is taken. */
  rename(newBasename: string): Promise<'renamed' | 'exists'>;
}

export interface SyncDeps {
  /** The adapter and base store of the source the card will live in (the target). */
  adapter: AdapterInterface;
  state: SyncState;
  rows: MappingRow[];
  /** Lookups for Apply: resolving a link may give a linked contact note its UID (a write to that note). */
  ctx: RelationContext;
  /** The same lookups without any write, for prepare (nothing is written before Apply). */
  readOnlyCtx: RelationContext;
  /** Warnings (note coercion, patch, a skipped rename); results come back as values. */
  notify(msg: string): void;
}

export type SyncOutcome = 'unchanged' | 'pulled' | 'pushed' | 'both' | 'created' | 'failed';

type Props = Record<string, FriendlyValue>;

export interface PreparedSync {
  uid: string;
  /** L as read (coerced, canonical relations, aligned dates). */
  local: Props;
  /** Mapped properties + source as read, for the staleness check at Apply. */
  noteSnapshot: string;
  server?: { lines: VCardLine[]; friendly: Friendly; href: string; etag: string; raw: string };
  base?: Props;
  rows: ReviewRow[];
  /** Where the card will live. */
  target: { sourceId: string };
  /** The card is currently in another source (Part 1 'move'); Apply moves it to the target. */
  move?: { from: CardLocation; adapter: AdapterInterface; state: SyncState };
}

export type PrepareResult = { kind: 'upToDate' } | { kind: 'review'; prepared: PreparedSync } | { kind: 'failed'; message: string };

export type ApplyResult =
  | { kind: 'done'; outcome: SyncOutcome; oldKept?: boolean }
  | { kind: 'stale'; reason: 'note' | 'server' }
  | { kind: 'failed'; message: string };

/** A server or card problem; ends the sync as `failed`. */
class SyncError extends Error {}

const isResponse = (value: unknown): value is AppHttpResponse =>
  typeof value === 'object' && value !== null && 'status' in value && 'errorMessage' in value;

export const describeResponse = (res: AppHttpResponse): string => res.errorMessage || `HTTP ${res.status}`;

export const succeeded = (res: AppHttpResponse): boolean => !res.errorMessage && res.status >= 200 && res.status < 300;

const cardUid = (raw: string): string => cleanUid(parseCard(raw).find((l) => !l.group && l.name === 'UID')?.value);

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The note's mapped properties (coerced, keys sorted) and its `source`, as one comparable string. */
function snapshotOf(frontmatter: Record<string, unknown>, rows: MappingRow[]): string {
  const { props } = coerceNoteProps(frontmatter, rows);
  const sorted = Object.keys(props)
    .sort()
    .map((key) => [key, props[key]]);
  const source = frontmatter[RESERVED_PROPERTY];
  return JSON.stringify({ props: sorted, source: source === undefined ? null : source });
}

/** The note's mapped properties a card can hold (unrepresentable keys such as `street-2` are left out). */
function representable(props: Props, rows: MappingRow[]): Props {
  return Object.fromEntries(Object.entries(props).filter(([p]) => !isUnrepresentable(p, rows)));
}

export async function prepareSync(
  note: NoteIO,
  deps: SyncDeps,
  where: { sourceId: string; move?: { from: CardLocation; adapter: AdapterInterface; state: SyncState } },
): Promise<PrepareResult> {
  try {
    const frontmatter = await note.readFrontmatter();
    const noteSnapshot = snapshotOf(frontmatter, deps.rows);
    const { props: coerced, warnings } = coerceNoteProps(frontmatter, deps.rows);
    for (const warning of warnings) deps.notify(warning);
    const local = representable(coerced, deps.rows);

    let uid = typeof local.uid === 'string' ? local.uid.trim() : '';
    const lookup = uid !== '';
    if (!lookup) {
      // Written to the note at Apply, never before.
      uid = `urn:uuid:${generateUUID()}`;
      local.uid = uid;
    }

    const state = where.move ? where.move.state : deps.state;
    const baseEntry = lookup ? await state.get(uid) : undefined;

    let server: PreparedSync['server'];
    if (where.move) {
      const { from, adapter } = where.move;
      const pulled = await pullCard(adapter, from.href, uid);
      server = serverCard(pulled, from.href, pulled.etag || from.etag, deps);
    } else {
      const meta = lookup ? await findCard(deps.adapter, uid) : undefined;
      if (meta) {
        const pulled = await pullCard(deps.adapter, meta.href, uid);
        server = serverCard(pulled, meta.href, pulled.etag || meta.etag, deps);
      } else if (baseEntry) {
        // A synced card that is gone (deleted, or not found by the lookup) is never silently recreated as a duplicate.
        throw new SyncError(`${typeof local.name === 'string' ? local.name : uid} was not found on the server.`);
      }
    }

    const baseLines = baseEntry ? parseCard(baseEntry.raw) : undefined;
    const baseCard = baseLines && { lines: baseLines, friendly: toFriendly(baseLines, deps.rows, deps.readOnlyCtx) };
    const base = baseCard?.friendly.props;

    // `urn:uuid:X` in the note and `X` on the server are the same UID (checked by pullCard); keep the server's spelling.
    const mine: Props = { ...local };
    if (server?.friendly.props.uid !== undefined) mine.uid = server.friendly.props.uid;
    if (typeof mine.uid === 'string') uid = mine.uid;
    // A legacy Apple `1604-03-12` in the note is the cards' `--03-12`: no difference.
    const aligned = alignNoteDates(mine, deps.rows, [baseCard, server && { lines: server.lines, friendly: server.friendly }]);
    const L = canonicalRelations(aligned, deps.readOnlyCtx, deps.rows);

    let rows = reviewRows(base, server?.friendly.props ?? {}, L, deps.rows, { newCard: server === undefined });
    // A new card's UID is no choice: Apply always writes the prepared one.
    if (!server) rows = rows.filter((r) => r.property !== 'uid');
    if (server && !where.move && isUpToDate(rows)) {
      // The only write before Apply (spec): a first Sync where both sides agree stores the card as the base.
      if (!baseEntry) await deps.state.set(uid, { raw: server.raw, etag: server.etag, href: server.href });
      return { kind: 'upToDate' };
    }

    const prepared: PreparedSync = { uid, local: L, noteSnapshot, server, base, rows, target: { sourceId: where.sourceId } };
    if (where.move) prepared.move = { ...where.move };
    return { kind: 'review', prepared };
  } catch (e) {
    return { kind: 'failed', message: errorText(e) };
  }
}

function serverCard(pulled: VCardRaw, href: string, etag: string | undefined, deps: SyncDeps): NonNullable<PreparedSync['server']> {
  const lines = parseCard(pulled.raw);
  return { lines, friendly: toFriendly(lines, deps.rows, deps.readOnlyCtx), href, etag: etag ?? '', raw: pulled.raw };
}

export async function applySync(
  prepared: PreparedSync,
  R: Props,
  note: NoteIO,
  deps: SyncDeps,
  opts: { rename?: string; sourceName: string },
): Promise<ApplyResult> {
  try {
    // 1. Nothing moved in the note while the user was reviewing.
    const frontmatter = await note.readFrontmatter();
    if (snapshotOf(frontmatter, deps.rows) !== prepared.noteSnapshot) return { kind: 'stale', reason: 'note' };

    // The card keeps the UID it was prepared with, whatever the choices say.
    const result: Props = { ...R, uid: prepared.uid };
    const { server } = prepared;

    // 2. The card.
    let final: Props;
    let warnings: string[];
    let stored: SyncStateEntry;
    let serverChanged: boolean;
    let oldKept: boolean | undefined;
    if (!server) {
      const card = newCard(result, deps.rows, deps.ctx);
      const raw = serializeCard(card.lines);
      const id = cleanUid(prepared.uid);
      const res = await deps.adapter.push({ uid: id, raw }, { ifNoneMatch: true });
      if (res.status === 412) return { kind: 'stale', reason: 'server' };
      if (!succeeded(res)) return { kind: 'failed', message: describeResponse(res) };
      stored = await createdBase(deps.adapter, id, raw, res);
      final = toFriendly(card.lines, deps.rows, deps.ctx).props;
      warnings = card.warnings;
      serverChanged = true;
    } else {
      const patched = patch(server.lines, server.friendly, result, deps.rows, deps.ctx);
      const raw = serializeCard(patched.lines);
      warnings = patched.warnings;
      serverChanged = raw !== serializeCard(server.lines);
      final = serverChanged ? toFriendly(patched.lines, deps.rows, deps.ctx).props : server.friendly.props;
      if (prepared.move) {
        const moved = await applyMove(prepared, prepared.move, serverChanged ? raw : server.raw, deps);
        if (moved.kind !== 'done') return moved;
        oldKept = moved.oldKept;
        serverChanged = true;
        stored = moved.base;
      } else if (serverChanged) {
        if (!server.etag) {
          return { kind: 'failed', message: `the server sent no ETag for ${server.href}; not writing without If-Match.` };
        }
        const res = await deps.adapter.push({ uid: cleanUid(prepared.uid), raw }, { href: server.href, ifMatch: server.etag });
        if (res.status === 412) return { kind: 'stale', reason: 'server' };
        if (!succeeded(res)) return { kind: 'failed', message: describeResponse(res) };
        // Without an ETag in the response the base keeps etag ''; the base etag is never used for If-Match.
        stored = { raw, etag: responseEtag(res), href: server.href };
      } else {
        stored = { raw: server.raw, etag: server.etag, href: server.href };
      }
    }

    // 3. The note takes the card as it now is, so numbering (`mobile-2` -> `mobile`) and link text are canonical.
    const noteChanged = await writeNote(note, deps, frontmatter, final, opts.sourceName);
    for (const warning of warnings) deps.notify(warning);
    if (opts.rename !== undefined) {
      // The card and the note are written by now: a rename problem is a warning, the base is still stored.
      try {
        if ((await note.rename(opts.rename)) === 'exists') deps.notify(`Not renamed: a note named "${opts.rename}" already exists.`);
      } catch (e) {
        deps.notify(`Not renamed to "${opts.rename}": ${errorText(e)}`);
      }
    }

    // 4. The base, under the target source (a move also forgets the old source's base).
    await deps.state.set(prepared.uid, stored);
    if (prepared.move) await prepared.move.state.remove(prepared.uid);

    const outcome: SyncOutcome = !server ? 'created' : serverChanged ? (noteChanged ? 'both' : 'pushed') : noteChanged ? 'pulled' : 'unchanged';
    return oldKept === undefined ? { kind: 'done', outcome } : { kind: 'done', outcome, oldKept };
  } catch (e) {
    return { kind: 'failed', message: errorText(e) };
  }
}

/**
 * Moves the (patched) card from `move.from` to the target: create there, delete the old one. The new base is
 * returned, not stored. The old card must still be the one reviewed; otherwise nothing is written.
 */
async function applyMove(
  prepared: PreparedSync,
  move: NonNullable<PreparedSync['move']>,
  raw: string,
  deps: SyncDeps,
): Promise<{ kind: 'done'; oldKept: boolean; base: SyncStateEntry } | Extract<ApplyResult, { kind: 'stale' | 'failed' }>> {
  const server = prepared.server as NonNullable<PreparedSync['server']>;
  const current = await move.adapter.pull(move.from.href);
  if (isResponse(current) || !current || current.raw !== server.raw || (current.etag && current.etag !== server.etag)) {
    return { kind: 'stale', reason: 'server' };
  }
  const result = await moveCard(
    raw,
    prepared.uid,
    { adapter: move.adapter, state: move.state, location: { ...move.from, etag: server.etag } },
    { adapter: deps.adapter, state: deps.state },
    { deferBase: true }, // applySync stores the base after the note (card, note, base).
  );
  if (!result.ok) return { kind: 'failed', message: result.message };
  if (!result.base) throw new SyncError('the move returned no base.');
  return { kind: 'done', oldKept: result.oldKept, base: result.base };
}

/**
 * Relation links as the card would show them: a link that resolves to a known contact becomes `[[<its name>]]`,
 * so `[[06 People/Sem de Vries]]` and the server's `[[Sem de Vries]]` are not seen as a change.
 */
function canonicalRelations(props: Props, ctx: RelationContext, rows: MappingRow[]): Props {
  const canonical = (item: string): string => {
    const resolved = ctx.resolveLink(linkTarget(item.trim()));
    const name = 'uid' in resolved ? ctx.uidToName(resolved.uid) : undefined;
    return name !== undefined && name !== '' ? toLink(name) : item;
  };
  const result: Props = { ...props };
  for (const [property, value] of Object.entries(props)) {
    if (rowForProperty(property, rows)?.row.kind !== 'relation') continue;
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
 * Makes the note's mapped properties equal to `final` (the card's friendly properties), touching only what
 * differs from the note as it is now, and writes `source: <sourceName>`. Returns whether mapped properties changed.
 */
async function writeNote(
  note: NoteIO,
  deps: SyncDeps,
  frontmatter: Record<string, unknown>,
  final: Props,
  sourceName: string,
): Promise<boolean> {
  const current = representable(coerceNoteProps(frontmatter, deps.rows).props, deps.rows);
  const set: Props = {};
  for (const [property, value] of Object.entries(final)) {
    // `urn:uuid:X` in the note and `X` on the card are the same UID: the note keeps its spelling.
    if (property === 'uid' && typeof value === 'string' && typeof current.uid === 'string' && cleanUid(value) === cleanUid(current.uid)) continue;
    if (!sameValue(value, current[property], property)) set[property] = value;
  }
  const remove = Object.keys(current).filter((p) => !(p in final) && isMappedProperty(p, deps.rows));
  const changed = Object.keys(set).length > 0 || remove.length > 0;
  if (frontmatter[RESERVED_PROPERTY] !== sourceName) set[RESERVED_PROPERTY] = sourceName;
  if (Object.keys(set).length > 0 || remove.length > 0) await note.writeProps(set, remove);
  return changed;
}
