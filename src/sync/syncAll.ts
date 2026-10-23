/**
 * Sync all: one worklist of every contact note that differs from its card. The scan runs each note through the
 * same round as "Sync this contact" (`prepareRound`) and only looks: every review is discarded, nothing is
 * written. Obsidian-free: the notes, their flow deps and the per-note lock come in through `SyncAllDeps`.
 */

import type { AppHttpResponse } from '../util/platformHttpClient';
import { cleanUid } from '../util/vcard';
import type { VCardMeta } from './adapters/adapter';
import type { AdapterInterface } from './adapters/adapterInterface';
import type { Choice } from './review';
import { prepareRound, ReviewRequest, SyncFlowDeps } from './syncFlow';

export interface SyncAllNote {
  path: string;
  name: string;
}

export interface SyncAllDeps {
  /** Contact notes to scan, `sync: false` already left out. */
  notes(): SyncAllNote[];
  /** Flow deps for a note with these overrides, or why it cannot be synced (say: needs Convert). */
  flowDeps(
    path: string,
    over: { notify(message: string): void; adapterFor?: SyncFlowDeps['adapterFor'] },
  ): Promise<SyncFlowDeps | { refused: string }>;
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

const DEFAULT_CONCURRENCY = 4;

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
      const list = await (listing ??= adapter.getMetaList());
      if (!Array.isArray(list)) return list;
      const wanted = cleanUid(uid);
      return list.find((meta) => cleanUid(meta.uid ?? '') === wanted);
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
      const done = { ...this.current };
      delete done.busy;
      this.update(done);
    }
  }

  private async scanNote(note: SyncAllNote, wrappers: Map<string, AdapterInterface>): Promise<SyncAllItem> {
    const base = { path: note.path, name: note.name };
    let release: (() => void) | undefined;
    try {
      release = this.deps.lock(note.path);
      if (!release) return { ...base, kind: 'blocked', reason: LOCKED_REASON };
      const messages: string[] = [];
      const deps = await this.deps.flowDeps(note.path, { notify: (message) => void messages.push(message) });
      if ('refused' in deps) return { ...base, kind: 'blocked', reason: deps.refused };
      const own = deps.adapterFor;
      const adapterFor: SyncFlowDeps['adapterFor'] = (source) => {
        let wrapper = wrappers.get(source.id);
        if (!wrapper) {
          wrapper = listedAdapter(own(source));
          wrappers.set(source.id, wrapper);
        }
        return wrapper;
      };
      const round = await prepareRound({ ...deps, adapterFor });
      if (round.kind === 'review') {
        await round.discard();
        const { request } = round;
        return { ...base, kind: 'review', request, badges: badgesOf(request), choices: new Map(), rename: true, messages };
      }
      const { result } = round;
      if (result.kind === 'refused' || result.kind === 'failed') return { ...base, kind: 'blocked', reason: result.message };
      return { ...base, kind: 'upToDate' };
    } catch (error) {
      return { ...base, kind: 'blocked', reason: errorText(error) };
    } finally {
      release?.();
    }
  }

  private update(next: SyncAllState): void {
    this.current = next;
    for (const listener of this.listeners) listener();
  }
}
