/**
 * One Sync of a contact note with its CardDAV card, in two phases.
 *
 * `prepareSync` reads the note (L), the base (B) and the server card (S) and returns either "up to date" or the
 * review rows; it writes nothing, except storing S as the base when everything is equal and no base exists (or the
 * base was read without some of the rows: a date with a label added after it was stored, a part an older reader
 * did not read, or a row Sync was turned back on for after it was stored, see `rowsForBase`).
 * `applySync` takes the result R built from the user's choices, checks nothing moved underneath, patches the card
 * line by line and writes it with If-Match, then renames the note (when asked), writes it and stores the base.
 * Nothing from obsidian or src/context: the note, the server and the base store all come in through `deps`.
 */

import { parseCard, serializeCard, VCardLine } from 'src/contacts/friendly/lines';
import { baseLeavesOut, rowsForBase, withFilledLeftOut, withUnfilledDates } from 'src/contacts/friendly/dateLabels';
import { isMappedProperty, MappingRow, RESERVED_PROPERTY, rowForProperty } from 'src/contacts/friendly/mapping';
import { alignNoteDates, coerceNoteProps, sameValue } from 'src/contacts/friendly/merge';
import { NoteLink, NoteLinkOptions, noteLinksDiffer, noteLinkUrl, wantedNoteLinks } from 'src/contacts/friendly/noteLinks';
import { notePhotoLines, photoDamagedOn, repairDamagedPhotos, repairNotePhotos, restoreDroppedPhotos } from 'src/contacts/friendly/photo';
import { linkTarget, RelationContext, toLink, uuidTarget } from 'src/contacts/friendly/relations';
import {
  CURRENT_READER,
  Friendly,
  FriendlyValue,
  needsLegacyRewrite,
  newCard,
  patch,
  Reader,
  readerOf,
  toFriendly,
} from 'src/contacts/friendly/translate';
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
  /**
   * Renames the contact to `newName`: the note, and the contact's folder with it when the note is in its own folder;
   * 'exists' (and nothing renamed) when a target is taken. `displayName`: the contact's new name for links to it (the
   * note does not have it yet: it is written after the rename).
   */
  rename(newName: string, displayName?: string): Promise<'renamed' | 'exists'>;
}

export interface SyncDeps {
  /** The adapter and base store of the source the card will live in (the target). */
  adapter: AdapterInterface;
  state: SyncState;
  rows: MappingRow[];
  /** Lookups for Apply: resolving a link may give a linked contact note its UID (a write to that note). */
  ctx: RelationContext;
  /**
   * The same lookups without any write, for prepare (nothing is written before Apply) and for canonical link text.
   * It must give the same `displayName` and `uidToName` answers as `ctx` (built from the same notes and contact
   * lists): prepare decides with it which relationship lines Apply rewrites (`needsLegacyRewrite`), and Apply
   * rewrites them with `ctx`. Were they to disagree, the review could ask for a rewrite Apply never does, every Sync.
   */
  readOnlyCtx: RelationContext;
  /** Warnings (note coercion, patch, a skipped rename); results come back as values. */
  notify(msg: string): void;
  /** The vCard version of a card created in the target book; asked only when creating. 4.0 when absent. */
  newCardVersion?(): Promise<'3.0' | '4.0'>;
  /**
   * Links to Obsidian notes on cards. Absent: no own vaults and no links (own links are neither read nor touched).
   * Present but not `enabled`: no links wanted, so the own links on a card are removed at its next Sync.
   */
  noteLinks?: NoteLinkOptions;
}

export type SyncOutcome = 'unchanged' | 'pulled' | 'pushed' | 'both' | 'created' | 'failed';

type Props = Record<string, FriendlyValue>;

export interface PreparedSync {
  uid: string;
  /** L as read (coerced, canonical relations, aligned dates). */
  local: Props;
  /** Mapped properties + source as read, for the staleness check at Apply. */
  noteSnapshot: string;
  /**
   * `raw` is the card as the server sent it (for staleness checks); `lines`, `friendly` and `baseRaw` (what is stored
   * as the base when the card is not written) are the card with damaged photos put back (`repairDamagedPhotos`).
   * `photoDamaged`: the server's copy of the photo is damaged (`photoDamagedOn`), stored with a base of this card.
   */
  server?: { lines: VCardLine[]; friendly: Friendly; href: string; etag: string; raw: string; baseRaw: string; photoDamaged: boolean };
  base?: Props;
  /**
   * The base for the rename check, when the base was read without some of the rows: `base` plus the base's values
   * for those rows (read with all rows), so parts that only became visible are no name change. Absent: `base`.
   */
  nameBase?: Props;
  rows: ReviewRow[];
  /** The card holds relationship lines the plugin wrote that Apply puts right (`needsLegacyRewrite`), 3.0 or 4.0. */
  rewriteRelations: boolean;
  /** The card's own links to Obsidian notes differ from the links wanted for the note; Apply puts them right. */
  rewriteLinks: boolean;
  /**
   * The note holds a damaged photo (`isDamagedPhoto`, written by an earlier version). `local` holds it put back from
   * the base, or not at all (`repairNotePhotos`); Apply writes the note with the result, which puts it right.
   */
  damagedNotePhoto: boolean;
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
  where: {
    sourceId: string;
    move?: { from: CardLocation; adapter: AdapterInterface; state: SyncState };
    /** The note's frontmatter as already read (by the book choice); read from the note when absent. */
    frontmatter?: Record<string, unknown>;
  },
): Promise<PrepareResult> {
  try {
    const frontmatter = where.frontmatter ?? (await note.readFrontmatter());
    const noteSnapshot = snapshotOf(frontmatter, deps.rows);
    const { props: coerced, warnings } = coerceNoteProps(frontmatter, deps.rows);
    for (const warning of warnings) deps.notify(warning);
    let local = representable(coerced, deps.rows);

    let uid = typeof local.uid === 'string' ? local.uid.trim() : '';
    const lookup = uid !== '';
    if (!lookup) {
      // Written to the note at Apply, never before.
      uid = `urn:uuid:${generateUUID()}`;
      local.uid = uid;
    }

    const state = where.move ? where.move.state : deps.state;
    const baseEntry = lookup ? await state.get(uid) : undefined;
    // A damaged photo (`isDamagedPhoto`) holds no image and says nothing about the photo. It is put right once, here,
    // so the review, the result, the note and the stored base all see the same photos (see repairDamagedPhotos):
    // - in a base an earlier version stored: left out. The note's photo never stands in for it, or a photo put back
    //   in the note would look as if the server already had it.
    // - in the note (an earlier version wrote the server's damage into it): the base's photo, or none. It is never
    //   pushed; Apply writes the note with the result, which removes it.
    // - on the server card: the base's photo, or none; without a base (never synced) the note's photo. With a base,
    //   the note's photo never stands in for it: a photo new in the note must still be pushed.
    // - gone from the server card while the base remembers that the server damaged it (`photoDamaged`): a phone that
    //   could not read it sends the card back without any PHOTO line, which is no removal. The base's photo.
    const baseLines = baseEntry ? repairDamagedPhotos(parseCard(baseEntry.raw), []).lines : undefined;
    const notePhotos = repairNotePhotos(local, baseLines ?? []);
    local = notePhotos.props;
    const wasDamaged = baseEntry?.photoDamaged === true;
    const repair = (lines: VCardLine[]) => {
      const repaired = repairDamagedPhotos(lines, baseLines ?? notePhotoLines(local, lines));
      if (!wasDamaged || !baseLines) return repaired;
      const restored = restoreDroppedPhotos(repaired.lines, baseLines);
      return { lines: restored.lines, repaired: repaired.repaired || restored.repaired };
    };

    let server: PreparedSync['server'];
    if (where.move) {
      const { from, adapter } = where.move;
      const pulled = await pullCard(adapter, from.href, uid);
      server = serverCard(pulled, from.href, pulled.etag || from.etag, deps, repair, wasDamaged);
    } else {
      const meta = lookup ? await findCard(deps.adapter, uid) : undefined;
      if (meta) {
        const pulled = await pullCard(deps.adapter, meta.href, uid);
        server = serverCard(pulled, meta.href, pulled.etag || meta.etag, deps, repair, wasDamaged);
      } else if (baseEntry) {
        // A synced card that is gone (deleted, or not found by the lookup) is never silently recreated as a duplicate.
        throw new SyncError(`${typeof local.name === 'string' ? local.name : uid} was not found on the server.`);
      }
    }

    // Read the way it was stored: lines and parts an older reader ignored then are the server's additions now. So are
    // the dates with a label added after the base was stored (the note may never have been filled from it, see
    // rowsForBase). A row Sync was turned back on for after the base was stored is skipped in it: the base may hold
    // its values from before, which are never read as the server removing them from the note.
    const baseReader = readerOf(baseEntry?.reader);
    const baseRows = rowsForBase(deps.rows, baseEntry, baseReader);
    const leavesOut = baseLeavesOut(deps.rows, baseEntry, baseReader);
    const baseCard = baseLines && {
      lines: baseLines,
      friendly: canonicalFriendly(readCard(baseLines, baseRows, deps.readOnlyCtx, deps, baseReader), deps),
    };
    const readBase = baseCard?.friendly.props;
    // The base read with every row, when it was read without some.
    const fullBase =
      baseLines && readBase && leavesOut
        ? canonicalFriendly(readCard(baseLines, deps.rows, deps.readOnlyCtx, deps, baseReader), deps).props
        : undefined;
    // A prefix that only became visible is no rename: the rename check sees the base's values for the rows left out.
    const nameBase =
      readBase && fullBase ? withUnfilledDates(readBase, fullBase, deps.rows, baseEntry, baseReader) : undefined;

    // `urn:uuid:X` in the note and `X` on the server are the same UID (checked by pullCard); keep the server's spelling.
    const mine: Props = { ...local };
    if (server?.friendly.props.uid !== undefined) mine.uid = server.friendly.props.uid;
    if (typeof mine.uid === 'string') uid = mine.uid;
    // A legacy Apple `1604-03-12` in the note is the cards' `--03-12`: no difference.
    const aligned = alignNoteDates(mine, deps.rows, [baseCard, server && { lines: server.lines, friendly: server.friendly }]);
    const L = canonicalRelations(aligned, deps.readOnlyCtx, deps.rows);
    // A left-out row the note already holds with the base's value was filled on another device: the base knew it.
    const base =
      readBase && fullBase ? withFilledLeftOut(readBase, fullBase, L, deps.rows, baseEntry, baseReader) : readBase;

    let rows = reviewRows(base, server?.friendly.props ?? {}, L, deps.rows, { newCard: server === undefined });
    // A new card's UID is no choice: Apply always writes the prepared one.
    if (!server) rows = rows.filter((r) => r.property !== 'uid');
    // Decided with the same lookups as Apply uses, so a line Apply cannot rewrite never reopens the review.
    const rewriteRelations = server !== undefined && needsLegacyRewrite(server.lines, deps.rows, deps.readOnlyCtx);
    // Against the links the note wants: the card's own links are no property, so no row shows them.
    const rewriteLinks =
      server !== undefined &&
      deps.noteLinks !== undefined &&
      noteLinksDiffer(server.lines, wantedLinks(L, uid, deps), deps.noteLinks.ownVaults);
    if (server && !where.move && isUpToDate(rows, rewriteRelations || rewriteLinks || notePhotos.repaired)) {
      // The only writes before Apply (spec): when both sides agree, the card is stored as the base on a first Sync,
      // and over a base read without some of the rows (a date with a label added after it was stored, a part of an
      // older reader, a row Sync was turned back on for after it was stored), so those rows count for this contact
      // from now on.
      // And when what the base remembers about the server's photo changed (`photoDamaged`).
      if (!baseEntry || leavesOut || wasDamaged !== server.photoDamaged) {
        await deps.state.set(uid, withPhotoDamaged({ raw: server.baseRaw, etag: server.etag, href: server.href, reader: CURRENT_READER }, server.photoDamaged));
      }
      return { kind: 'upToDate' };
    }

    const prepared: PreparedSync = {
      uid,
      local: L,
      noteSnapshot,
      server,
      base,
      rows,
      rewriteRelations,
      rewriteLinks,
      damagedNotePhoto: notePhotos.repaired,
      target: { sourceId: where.sourceId },
    };
    if (nameBase) prepared.nameBase = nameBase;
    if (where.move) prepared.move = { ...where.move };
    return { kind: 'review', prepared };
  } catch (e) {
    return { kind: 'failed', message: errorText(e) };
  }
}

function serverCard(
  pulled: VCardRaw,
  href: string,
  etag: string | undefined,
  deps: SyncDeps,
  repair: (lines: VCardLine[]) => { lines: VCardLine[]; repaired: boolean },
  wasDamaged: boolean,
): NonNullable<PreparedSync['server']> {
  const sent = parseCard(pulled.raw);
  const { lines, repaired } = repair(sent);
  const friendly = canonicalFriendly(readCard(lines, deps.rows, deps.readOnlyCtx, deps), deps);
  const baseRaw = repaired ? serializeCard(lines) : pulled.raw;
  return { lines, friendly, href, etag: etag ?? '', raw: pulled.raw, baseRaw, photoDamaged: photoDamagedOn(sent, wasDamaged) };
}

/** `entry` with `photoDamaged` set when true, and without it otherwise. */
function withPhotoDamaged(entry: SyncStateEntry, photoDamaged: boolean): SyncStateEntry {
  const { photoDamaged: _, ...rest } = entry;
  return photoDamaged ? { ...rest, photoDamaged: true } : rest;
}

/**
 * Whether the server's copy of the photo is damaged after `raw` was written to `href`: read back when `raw` holds a
 * photo (the server may damage it on the way in), else, or when it cannot be read, `previous`.
 */
async function photoDamagedAfterWrite(adapter: AdapterInterface, href: string, raw: string, previous: boolean): Promise<boolean> {
  if (!parseCard(raw).some((l) => l.name === 'PHOTO')) return previous;
  try {
    const stored = await adapter.pull(href);
    return isResponse(stored) || !stored ? previous : photoDamagedOn(parseCard(stored.raw), previous);
  } catch {
    return previous;
  }
}

/** Every card read in Sync: the card's own links to Obsidian notes are never read (no `website`, no row). */
function readCard(lines: VCardLine[], rows: MappingRow[], ctx: RelationContext, deps: SyncDeps, reader?: Reader): Friendly {
  return toFriendly(lines, rows, ctx, { reader, ownVaults: deps.noteLinks?.ownVaults ?? [] });
}

/**
 * The links to Obsidian notes the card of the contact with `uid` should hold for `props`; none when the setting is
 * off. Always decided with `readOnlyCtx`, in prepare and in Apply alike (see `SyncDeps.readOnlyCtx`). A relationship
 * to the contact itself gets no link: its own note is found the way its relationships are (its link text, `uidToName`).
 */
function wantedLinks(props: Props, uid: string, deps: SyncDeps): NoteLink[] {
  const options = deps.noteLinks;
  if (!options?.enabled) return [];
  const ctx = deps.readOnlyCtx;
  const links = wantedNoteLinks(props, deps.rows, ctx, options.vault);
  const ownName = ctx.uidToName(uid);
  const ownNote = ownName ? ctx.contactNote?.(linkTarget(toLink(ownName))) : undefined;
  const ownUrl = ownNote && noteLinkUrl(options.vault, ownNote.path);
  return ownUrl === undefined ? links : links.filter((link) => link.url !== ownUrl);
}

/** What `patch` and `newCard` get: with the link options, the card's own links are made equal to the wanted ones. */
function linkOptions(props: Props, uid: string, deps: SyncDeps): { noteLinks?: { wanted: NoteLink[]; ownVaults: string[] } } {
  return deps.noteLinks ? { noteLinks: { wanted: wantedLinks(props, uid, deps), ownVaults: deps.noteLinks.ownVaults } } : {};
}

/**
 * A card's properties with canonical relation links (as the note's are), so a name the phone left without the
 * hint (`[[Sem de Vries]]`) and the note's link to that contact (`[[Contacts/Sem de Vries/index|Sem de Vries]]`) are
 * not seen as a change. Provenance stays: only link text changes, never the number or order of items.
 */
function canonicalFriendly(friendly: Friendly, deps: SyncDeps): Friendly {
  return { props: canonicalRelations(friendly.props, deps.readOnlyCtx, deps.rows), source: friendly.source };
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
      const version = deps.newCardVersion ? await deps.newCardVersion() : '4.0';
      // From the result, as everything Apply writes.
      const card = newCard(result, deps.rows, deps.ctx, version, linkOptions(result, prepared.uid, deps));
      const raw = serializeCard(card.lines);
      const id = cleanUid(prepared.uid);
      const res = await deps.adapter.push({ uid: id, raw }, { ifNoneMatch: true });
      if (res.status === 412) return { kind: 'stale', reason: 'server' };
      if (!succeeded(res)) return { kind: 'failed', message: describeResponse(res) };
      stored = await createdBase(deps.adapter, id, raw, res);
      final = canonicalRelations(readCard(card.lines, deps.rows, deps.ctx, deps).props, deps.readOnlyCtx, deps.rows);
      warnings = card.warnings;
      serverChanged = true;
    } else {
      // Links from the result, so a relationship taken from the card gets its link in this same Apply.
      const patched = patch(server.lines, server.friendly, result, deps.rows, deps.ctx, {
        rewriteLegacyRelations: prepared.rewriteRelations,
        ...linkOptions(result, prepared.uid, deps),
      });
      const raw = serializeCard(patched.lines);
      warnings = patched.warnings;
      serverChanged = raw !== serializeCard(server.lines);
      // As prepared: canonical links, so a name without the hint does not replace the note's link to that contact.
      final = serverChanged
        ? canonicalRelations(readCard(patched.lines, deps.rows, deps.ctx, deps).props, deps.readOnlyCtx, deps.rows)
        : server.friendly.props;
      if (prepared.move) {
        const moved = await applyMove(prepared, prepared.move, serverChanged ? raw : server.baseRaw, deps);
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
        stored = withPhotoDamaged(
          { raw, etag: responseEtag(res), href: server.href, reader: CURRENT_READER },
          await photoDamagedAfterWrite(deps.adapter, server.href, raw, server.photoDamaged),
        );
      } else {
        stored = withPhotoDamaged({ raw: server.baseRaw, etag: server.etag, href: server.href, reader: CURRENT_READER }, server.photoDamaged);
      }
    }

    // 3. The note: renamed first, so the relationship mirror sees the property change under the final path.
    if (opts.rename !== undefined) {
      // The card is written by now: a rename problem is a warning, and the note and the base are still written.
      try {
        // The new name goes along: links to the contact are rewritten before the note gets its new `name`.
        const displayName = typeof final.name === 'string' ? final.name : undefined;
        if ((await note.rename(opts.rename, displayName)) === 'exists') deps.notify(`Not renamed: "${opts.rename}" already exists.`);
      } catch (e) {
        deps.notify(`Not renamed to "${opts.rename}": ${errorText(e)}`);
      }
    }
    // It takes the card as it now is, so numbering (`mobile-2` -> `mobile`) and link text are canonical.
    const noteChanged = await writeNote(note, deps, frontmatter, final, opts.sourceName);
    for (const warning of warnings) deps.notify(warning);

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
    { deferBase: true, photoDamaged: server.photoDamaged }, // applySync stores the base after the note (card, note, base).
  );
  if (!result.ok) return { kind: 'failed', message: result.message };
  if (!result.base) throw new SyncError('the move returned no base.');
  return { kind: 'done', oldKept: result.oldKept, base: result.base };
}

/**
 * Relation links in one form: a link that resolves to a known contact becomes that contact's link text
 * (`uidToName`), so `[[06 People/Sem de Vries]]`, a plain `[[Sem de Vries]]` from the card and the link Sync writes
 * are not seen as a change. `[[urn:uuid:<uid>]]` (a phone's "urn:uuid:…" name that reached the note) is that contact
 * too. Unknown and ambiguous names stay as they are. Used for every side: note, base, card, and what Apply writes.
 */
function canonicalRelations(props: Props, ctx: RelationContext, rows: MappingRow[]): Props {
  const canonical = (item: string): string => {
    const target = linkTarget(item.trim());
    const uuid = uuidTarget(target);
    const resolved = uuid !== undefined ? { uid: uuid } : ctx.resolveLink(target);
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
export async function createdBase(
  adapter: AdapterInterface,
  id: string,
  raw: string,
  res: AppHttpResponse,
  previousPhotoDamaged = false,
): Promise<SyncStateEntry> {
  let meta: VCardMeta | undefined;
  try {
    const found = await adapter.getMetaByUid(id);
    meta = !isResponse(found) && found && sameUid(found, id) ? found : undefined;
  } catch {
    meta = undefined;
  }
  const href = meta?.href ?? `${encodeURIComponent(id)}.vcf`;
  const base = { raw, etag: responseEtag(res) || meta?.etag || '', href, reader: CURRENT_READER };
  return withPhotoDamaged(base, await photoDamagedAfterWrite(adapter, href, raw, previousPhotoDamaged));
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
