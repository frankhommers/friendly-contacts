/**
 * Sync all: one worklist of every contact note that differs from its card. The scan runs each note through the
 * same round as "Sync this contact" (`prepareRound`) and only looks: every review is discarded, nothing is
 * written. Apply prepares the note again and commits only when it still shows what was listed (`sameReview`).
 * Obsidian-free: the notes, their flow deps and the per-note lock come in through `SyncAllDeps`.
 */

import type { AppHttpResponse } from '../util/platformHttpClient';
import { cleanUid } from '../util/vcard';
import type { VCardMeta } from './adapters/adapter';
import type { AdapterInterface } from './adapters/adapterInterface';
import { canApply, Choice } from './review';
import { prepareRound, ReviewRequest, SyncFlowDeps } from './syncFlow';

export interface SyncAllNote {
  path: string;
  name: string;
}

export interface SyncAllDeps {
  /** Contact notes to scan, `sync: false` already left out. */
  notes(): SyncAllNote[];
  /** Flow deps for a note with these overrides, or why it cannot be synced (say: needs Convert). */
  flowDeps(path: string, over: { notify(message: string): void }): Promise<SyncFlowDeps | { refused: string }>;
  /** The one-Sync-per-note lock: a release function, or undefined when a Sync of the note is running. */
  lock(path: string): (() => void) | undefined;
  /** Notes prepared at once; default 4. */
  concurrency?: number;
}

/** What a review would change: a conflict to decide, values from the server, from Obsidian, or a new card. */
export type Badge = 'conflict' | 'server' | 'obsidian' | 'newCard';

type Base = { path: string; name: string };

export type SyncAllItem = Base &
  (
    | { kind: 'upToDate' }
    | { kind: 'review'; request: ReviewRequest; badges: Badge[]; choices: Map<string, Choice>; rename: boolean; messages: string[] }
    | { kind: 'done'; messages: string[] }
    | { kind: 'blocked'; reason: string }
  );

export interface SyncAllState {
  items: SyncAllItem[];
  scanned: number;
  total: number;
  busy?: 'scan' | 'apply';
}

/** The reason of a note whose "Sync this contact" is running (or whose lock is held otherwise). */
const LOCKED_REASON = 'A Sync of this contact is already open.';

/** Added to an item whose note or card changed after it was listed: shown again, nothing written. */
export const CHANGED_SINCE_SCAN = 'Changed since the scan; check it again.';

const DEFAULT_CONCURRENCY = 4;

/**
 * Two prepares show the same thing: Apply may use choices made on the first for the second. A new card's random
 * UID is not in its rows, so two prepares of the same new note are the same.
 */
export function sameReview(a: ReviewRequest, b: ReviewRequest): boolean {
  const pa = a.prepared;
  const pb = b.prepared;
  return (
    a.title === b.title &&
    a.moveLine === b.moveLine &&
    a.rewriteLine === b.rewriteLine &&
    a.linksLine === b.linksLine &&
    a.photoLine === b.photoLine &&
    a.serverName === b.serverName &&
    pa.noteSnapshot === pb.noteSnapshot &&
    pa.server?.raw === pb.server?.raw &&
    pa.server?.etag === pb.server?.etag &&
    JSON.stringify(pa.rows) === JSON.stringify(pb.rows) &&
    pa.rewriteRelations === pb.rewriteRelations &&
    pa.rewriteLinks === pb.rewriteLinks &&
    pa.damagedNotePhoto === pb.damagedNotePhoto &&
    pa.target.sourceId === pb.target.sourceId &&
    pa.move?.from.href === pb.move?.from.href
  );
}

export function badgesOf(request: ReviewRequest): Badge[] {
  const { prepared } = request;
  if (prepared.server === undefined) return ['newCard'];
  const changed = prepared.rows.filter((r) => r.changed);
  const badges: Badge[] = [];
  if (changed.some((r) => r.preselect === undefined)) badges.push('conflict');
  if (changed.some((r) => r.preselect === 'server') || prepared.damagedNotePhoto) badges.push('server');
  if (changed.some((r) => r.preselect === 'local') || prepared.rewriteRelations || prepared.rewriteLinks || request.moveLine) {
    badges.push('obsidian');
  }
  return badges;
}

/**
 * The adapter with `getMetaByUid` answered from one listing of the book (read on the first lookup), so a scan of
 * many notes reads each book once. A listing that fails is returned as that error for every lookup.
 */
export function listedAdapter(adapter: AdapterInterface): AdapterInterface {
  let listing: Promise<VCardMeta[] | AppHttpResponse> | undefined;
  return {
    push: (vcard, opts) => adapter.push(vcard, opts),
    delete: (href, ifMatch) => adapter.delete(href, ifMatch),
    pull: (href) => adapter.pull(href),
    getMetaList: () => adapter.getMetaList(),
    checkConnectivity: () => adapter.checkConnectivity(),
    async getMetaByUid(uid) {
      const wanted = cleanUid(uid);
      if (wanted === '') return undefined;
      const list = await (listing ??= adapter.getMetaList());
      if (!Array.isArray(list)) return list;
      return list.find((meta) => meta.uid !== undefined && cleanUid(meta.uid) === wanted);
    },
  };
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export class SyncAll {
  private current: SyncAllState = { items: [], scanned: 0, total: 0 };
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: SyncAllDeps) {}

  get state(): SyncAllState {
    return this.current;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** Prepares every note (at most `concurrency` at once) and lists what a Sync of it would do. */
  async scan(): Promise<void> {
    if (this.current.busy) return;
    const notes = this.deps.notes();
    this.update({ items: [], scanned: 0, total: notes.length, busy: 'scan' });
    // One listed wrapper per address book for this scan, so a rescan reads fresh listings.
    const wrappers = new Map<string, AdapterInterface>();
    let next = 0;
    const worker = async () => {
      while (next < notes.length) {
        const note = notes[next++];
        const item = await this.scanNote(note, wrappers);
        const items = [...this.current.items, item].sort((a, b) => a.name.localeCompare(b.name));
        this.update({ ...this.current, items, scanned: this.current.scanned + 1 });
      }
    };
    try {
      const workers = Math.max(1, Math.min(this.deps.concurrency ?? DEFAULT_CONCURRENCY, notes.length));
      await Promise.all(Array.from({ length: workers }, worker));
    } finally {
      this.setBusy(undefined);
    }
  }

  setChoices(path: string, choices: Map<string, Choice>): void {
    const item = this.find(path);
    if (item?.kind === 'review') this.put({ ...item, choices: new Map(choices) });
  }

  setRename(path: string, rename: boolean): void {
    const item = this.find(path);
    if (item?.kind === 'review') this.put({ ...item, rename });
  }

  /** Prepare again (after an Import in the review), replacing the item. */
  async refresh(path: string): Promise<void> {
    if (this.current.busy) return;
    const item = this.find(path);
    if (!item) return;
    const release = this.deps.lock(path);
    if (!release) {
      this.put(withMessage(item, LOCKED_REASON));
      return;
    }
    try {
      this.put(await this.prepareItem(item));
    } finally {
      release();
    }
  }

  /** Applies a listed review with its choices, when the note and the card still show what was listed. */
  async apply(path: string): Promise<void> {
    if (this.current.busy) return;
    this.setBusy('apply');
    try {
      await this.applyOne(path);
    } finally {
      this.setBusy(undefined);
    }
  }

  /** Paths "Apply all that are ready" would apply now. */
  readyPaths(): string[] {
    return this.current.items
      .filter((item) => item.kind === 'review' && !item.badges.includes('newCard') && canApply(item.request.prepared.rows, item.choices))
      .map((item) => item.path);
  }

  /** Applies every ready contact, one after another. */
  async applyAllReady(): Promise<{ applied: number; changed: number; failed: number }> {
    const counts = { applied: 0, changed: 0, failed: 0 };
    if (this.current.busy) return counts;
    const paths = this.readyPaths();
    this.setBusy('apply');
    try {
      for (const path of paths) counts[await this.applyOne(path)]++;
    } finally {
      this.setBusy(undefined);
    }
    return counts;
  }

  /** One Apply, without the busy guard: `applied` (done), `changed` (shown again), or `failed`. */
  private async applyOne(path: string): Promise<'applied' | 'changed' | 'failed'> {
    const item = this.find(path);
    if (item?.kind !== 'review') return 'failed';
    const base = { path: item.path, name: item.name };
    let release: (() => void) | undefined;
    try {
      release = this.deps.lock(path);
      if (!release) {
        this.put(withMessage(item, LOCKED_REASON));
        return 'failed';
      }
      const messages: string[] = [];
      const deps = await this.deps.flowDeps(path, { notify: (message) => void messages.push(message) });
      if ('refused' in deps) {
        this.put({ ...base, kind: 'blocked', reason: deps.refused });
        return 'failed';
      }
      const round = await prepareRound(deps);
      if (round.kind === 'end') {
        const { result } = round;
        if (result.kind === 'upToDate') {
          this.put({ ...base, kind: 'done', messages: ['Already in sync.'] });
          return 'applied';
        }
        this.put({ ...base, kind: 'blocked', reason: 'message' in result ? result.message : result.kind });
        return 'failed';
      }
      const fresh = round.request;
      if (!sameReview(item.request, fresh)) {
        await round.discard();
        this.put(withMessage(reviewItem(base, fresh, messages), CHANGED_SINCE_SCAN));
        return 'changed';
      }
      const committed = await round.commit({ kind: 'apply', choices: item.choices, rename: item.rename });
      if (committed.kind === 'stale') {
        this.put(withMessage(await this.prepareItem(base), CHANGED_SINCE_SCAN));
        return 'changed';
      }
      if (committed.result.kind === 'done') {
        this.put({ ...base, kind: 'done', messages });
        return 'applied';
      }
      // Failed: stays listed with what the round showed, the choices kept.
      this.put({ ...item, request: fresh, badges: badgesOf(fresh), messages });
      return 'failed';
    } catch (error) {
      this.put({ ...base, kind: 'blocked', reason: errorText(error) });
      return 'failed';
    } finally {
      release?.();
    }
  }

  private async scanNote(note: SyncAllNote, wrappers: Map<string, AdapterInterface>): Promise<SyncAllItem> {
    let release: (() => void) | undefined;
    try {
      release = this.deps.lock(note.path);
      if (!release) return { path: note.path, name: note.name, kind: 'blocked', reason: LOCKED_REASON };
      return await this.prepareItem(note, (own) => (source) => {
        let wrapper = wrappers.get(source.id);
        if (!wrapper) {
          wrapper = listedAdapter(own(source));
          wrappers.set(source.id, wrapper);
        }
        return wrapper;
      });
    } catch (error) {
      return { path: note.path, name: note.name, kind: 'blocked', reason: errorText(error) };
    } finally {
      release?.();
    }
  }

  /**
   * Prepares a note (its lock held by the caller) and lists what a Sync would do; the review is discarded.
   * `wrap` replaces the note's adapters (the scan's listed ones); without it the real lookups are used.
   */
  private async prepareItem(
    note: SyncAllNote,
    wrap?: (own: SyncFlowDeps['adapterFor']) => SyncFlowDeps['adapterFor'],
  ): Promise<SyncAllItem> {
    const base = { path: note.path, name: note.name };
    try {
      const messages: string[] = [];
      const deps = await this.deps.flowDeps(note.path, { notify: (message) => void messages.push(message) });
      if ('refused' in deps) return { ...base, kind: 'blocked', reason: deps.refused };
      const round = await prepareRound(wrap ? { ...deps, adapterFor: wrap(deps.adapterFor) } : deps);
      if (round.kind === 'review') {
        await round.discard();
        return reviewItem(base, round.request, messages);
      }
      const { result } = round;
      if (result.kind === 'refused' || result.kind === 'failed') return { ...base, kind: 'blocked', reason: result.message };
      return { ...base, kind: 'upToDate' };
    } catch (error) {
      return { ...base, kind: 'blocked', reason: errorText(error) };
    }
  }

  private find(path: string): SyncAllItem | undefined {
    return this.current.items.find((item) => item.path === path);
  }

  /** Replaces the item with the same path (same name, so the order stays). */
  private put(item: SyncAllItem): void {
    if (!this.find(item.path)) return;
    this.update({ ...this.current, items: this.current.items.map((i) => (i.path === item.path ? item : i)) });
  }

  private setBusy(busy: SyncAllState['busy']): void {
    const next = { ...this.current };
    if (busy) next.busy = busy;
    else delete next.busy;
    this.update(next);
  }

  private update(next: SyncAllState): void {
    this.current = next;
    // A listener that throws (a view that failed to render) must not break a scan or an Apply.
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        console.error('Sync all: a listener failed', error);
      }
    }
  }
}

function reviewItem(base: Base, request: ReviewRequest, messages: string[]): SyncAllItem {
  return { ...base, kind: 'review', request, badges: badgesOf(request), choices: new Map(), rename: true, messages };
}

/** The item with this message added; items without messages (up to date, blocked) are kept as they are. */
function withMessage(item: SyncAllItem, message: string): SyncAllItem {
  return item.kind === 'review' || item.kind === 'done' ? { ...item, messages: [...item.messages, message] } : item;
}
