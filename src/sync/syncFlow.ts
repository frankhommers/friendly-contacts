/**
 * One "Sync" of a contact note, start to end: which address book (Part 1), prepare, the review screen, Apply,
 * and reopening the review with fresh data when something changed underneath. Obsidian-free: the note, the
 * address books, the review screen and the Notices come in through `SyncFlowDeps` (wired in src/sync/sync.ts).
 */

import { MappingRow } from '../contacts/friendly/mapping';
import { coerceNoteProps } from '../contacts/friendly/merge';
import { RelationContext } from '../contacts/friendly/relations';
import type { Source } from '../settings/settings.d';
import type { AdapterInterface } from './adapters/adapterInterface';
import { Choice, resultProps } from './review';
import { alsoChanges, MirrorLookup, renameTarget } from './reviewExtras';
import { BaseHolder, noteSourceId, planSync, SyncPlan } from './sources';
import { applySync, locateCard, NoteIO, PreparedSync, prepareSync, SyncDeps, SyncOutcome } from './syncContact';
import type { SyncState } from './syncState';

/** How often the review reopens after the note or the card changed underneath, before Sync gives up. */
export const MAX_REOPENS = 3;

export interface ReviewRequest {
  /** `<name>`, or `New card in <source>`. */
  title: string;
  /** `Address book: <from> -> <to>` when the card moves. */
  moveLine?: string;
  prepared: PreparedSync;
  /** "Also changes" for the result of these choices. */
  also(choices: Map<string, Choice>): string[];
  /** The rename the result of these choices brings; `blocked` says why it cannot be done. */
  rename(choices: Map<string, Choice>): { to: string; blocked?: string } | undefined;
}

export type ReviewDecision =
  | { kind: 'apply'; choices: Map<string, Choice>; rename: boolean }
  | { kind: 'cancel' }
  /** The user imported a person from the review: prepare again and show it anew. */
  | { kind: 'reopen' };

export interface FlowContexts {
  /** For Apply: resolving a link may give a linked contact note its UID. */
  ctx: RelationContext;
  /** For prepare: never writes. */
  readOnlyCtx: RelationContext;
  /** Waits for the writes `ctx` started (UIDs given to linked notes). */
  settle(): Promise<void>;
}

export interface SyncFlowDeps {
  note: NoteIO;
  /** The note's path and file name (without extension). */
  path: string;
  name: string;
  rows: MappingRow[];
  /** Every configured address book, and the enabled ones. */
  sources: Source[];
  active: Source[];
  defaultSource: string;
  adapterFor(source: Source): AdapterInterface;
  stateFor(sourceId: string): SyncState;
  /** Fresh relationship lookups for one round. */
  contexts(): Promise<FlowContexts>;
  /** Shows the review screen; resolves with what the user did. */
  review(request: ReviewRequest): Promise<ReviewDecision>;
  notify(message: string): void;
  /** Mirroring as it runs on this device; absent when it does not (then there are no "Also changes"). */
  mirror?: MirrorLookup & { nameOf(path: string): string };
  /** True when a note with this file name exists next to the synced note (not the note itself). */
  nameTaken(basename: string): boolean;
}

export type FlowResult =
  | { kind: 'refused'; message: string }
  | { kind: 'failed'; message: string }
  | { kind: 'upToDate'; plan: SyncPlan }
  | { kind: 'cancelled'; plan: SyncPlan }
  | { kind: 'done'; plan: SyncPlan; outcome: SyncOutcome; oldKept?: boolean }
  /** The note or the card kept changing while the review was open. */
  | { kind: 'gaveUp' };

const OUTCOME_TEXT: Record<Exclude<SyncOutcome, 'failed'>, string> = {
  unchanged: 'already in sync',
  pulled: 'updated from the server',
  pushed: 'sent to the server',
  both: 'updated from and sent to the server',
  created: 'created on the server',
};

type Round =
  | { kind: 'end'; result: FlowResult }
  | { kind: 'stale'; reason: 'note' | 'server' }
  | { kind: 'reopen' };

export async function syncFlow(deps: SyncFlowDeps): Promise<FlowResult> {
  let stale = 0;
  for (;;) {
    const round = await syncRound(deps);
    if (round.kind === 'end') return round.result;
    if (round.kind === 'reopen') continue;
    deps.notify(round.reason === 'server' ? `${deps.name} changed on the server meanwhile` : `${deps.name} changed while reviewing`);
    if (++stale > MAX_REOPENS) {
      deps.notify(`${deps.name} keeps changing; nothing was synced. Try again later.`);
      return { kind: 'gaveUp' };
    }
  }
}

/** The note's `source:` name; undefined when the property is missing or empty. */
function sourceProperty(frontmatter: Record<string, unknown>): string | undefined {
  const value = frontmatter.source;
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text === '' ? undefined : text;
}

const sourceNameIn = (sources: Source[]) => (id: string) => sources.find((s) => s.id === id)?.name ?? id;

/** A lookup that failed in some books: the card could be there, so nothing may be created or moved. */
function searchFailure(failed: { sourceId: string; message: string }[], sourceName: (id: string) => string): string {
  const which = failed.map((f) => `${sourceName(f.sourceId)} (${f.message})`).join(', ');
  return `could not search ${which}, and the card could be there`;
}

type Where = { target: Source; plan: SyncPlan; move?: { from: Source; location: Extract<SyncPlan, { kind: 'move' }>['from'] } };

/** Part 1: the book the note belongs to, a search of every active book for its UID, then sync, adopt, move or refuse. */
async function chooseSource(
  deps: SyncFlowDeps,
  frontmatter: Record<string, unknown>,
): Promise<Where | { refused: string } | { failed: string }> {
  const { active, sources } = deps;
  if (active.length === 0) return { refused: 'Sync is not set up' };
  const uidValue = coerceNoteProps(frontmatter, deps.rows).props.uid;
  const uid = typeof uidValue === 'string' ? uidValue.trim() : '';
  const named = sourceProperty(frontmatter);

  const baseIn: string[] = [];
  if (uid !== '') {
    // Active books first; a base only in a disabled book makes noteSourceId refuse rather than pick the default.
    const inactive = sources.filter((s) => !active.some((a) => a.id === s.id));
    for (const source of [...active, ...inactive]) {
      if (await deps.stateFor(source.id).get(uid)) baseIn.push(source.id);
    }
  }
  const resolved = noteSourceId(named, sources, baseIn, deps.defaultSource);
  if ('error' in resolved) return { refused: resolved.error };
  const own = active.find((s) => s.id === resolved.id);
  if (!own) return { refused: 'Sync is not set up' };
  const byId = (id: string) => active.find((s) => s.id === id);
  const sourceName = sourceNameIn(sources);

  let plan: SyncPlan = { kind: 'sync', sourceId: own.id };
  if (uid !== '') {
    // Before anything is created or moved, every active book is searched for the exact UID.
    const { found, failed } = await locateCard(active.map((s) => ({ sourceId: s.id, adapter: deps.adapterFor(s) })), uid);
    if (failed.length > 0 && !found.some((f) => f.sourceId === own.id)) {
      return { failed: searchFailure(failed, sourceName) };
    }
    const holders: BaseHolder[] = baseIn.map((id) => ({ id, active: active.some((a) => a.id === id) }));
    plan = planSync({ id: own.id, explicit: named !== undefined }, found, sourceName, holders);
  }

  switch (plan.kind) {
    case 'refuse':
      return { refused: plan.message.replace(/\.$/, '') };
    case 'sync':
    case 'adopt': {
      const target = byId(plan.sourceId);
      return target ? { target, plan } : { refused: 'Sync is not set up' };
    }
    case 'move': {
      const from = byId(plan.from.sourceId);
      const target = byId(plan.to);
      return from && target ? { target, plan, move: { from, location: plan.from } } : { refused: 'Sync is not set up' };
    }
  }
}

async function syncRound(deps: SyncFlowDeps): Promise<Round> {
  const end = (result: FlowResult): Round => ({ kind: 'end', result });
  const where = await chooseSource(deps, await deps.note.readFrontmatter());
  if ('refused' in where) {
    deps.notify(`Not syncing ${deps.name}: ${where.refused}.`);
    return end({ kind: 'refused', message: where.refused });
  }
  if ('failed' in where) {
    deps.notify(`Not syncing ${deps.name}: ${where.failed}.`);
    return end({ kind: 'failed', message: where.failed });
  }
  const { target, plan, move } = where;

  const contexts = await deps.contexts();
  try {
    const syncDeps: SyncDeps = {
      adapter: deps.adapterFor(target),
      state: deps.stateFor(target.id),
      rows: deps.rows,
      ctx: contexts.ctx,
      readOnlyCtx: contexts.readOnlyCtx,
      notify: deps.notify,
    };
    const moveFrom = move && { from: move.location, adapter: deps.adapterFor(move.from), state: deps.stateFor(move.from.id) };
    const prepared = await prepareSync(deps.note, syncDeps, { sourceId: target.id, move: moveFrom });
    if (prepared.kind === 'failed') {
      deps.notify(`Sync failed: ${prepared.message}`);
      return end({ kind: 'failed', message: prepared.message });
    }
    if (prepared.kind === 'upToDate') {
      deps.notify('Up to date');
      return end({ kind: 'upToDate', plan });
    }

    const review = prepared.prepared;
    const server = review.server?.friendly.props ?? {};
    const result = (choices: Map<string, Choice>) => resultProps(review.rows, choices, server);
    const renameTo = (choices: Map<string, Choice>): { to: string; blocked?: string } | undefined => {
      // A name changed since the last Sync on either side (against the base; without one, the note's values)
      // renames; a note renamed by hand with unchanged names is left alone, and a declined rename is not offered
      // again (the base then holds the new name).
      const to = renameTarget(review.base ?? review.local, result(choices), deps.rows);
      if (to === undefined || to === deps.name) return undefined;
      return deps.nameTaken(to) ? { to, blocked: `A note named "${to}" already exists in this folder.` } : { to };
    };
    const { mirror } = deps;
    const decision = await deps.review({
      title: review.server ? deps.name : `New card in ${target.name}`,
      moveLine: move ? `Address book: ${move.from.name} -> ${target.name}` : undefined,
      prepared: review,
      also: (choices) => (mirror ? alsoChanges(deps.path, review.local, result(choices), deps.rows, mirror, mirror.nameOf) : []),
      rename: renameTo,
    });
    if (decision.kind === 'cancel') return end({ kind: 'cancelled', plan });
    if (decision.kind === 'reopen') return { kind: 'reopen' };

    if (move) {
      // The card must still be only in the book it moves from; anything else is a change on the server.
      const { found, failed } = await locateCard(
        deps.active.map((s) => ({ sourceId: s.id, adapter: deps.adapterFor(s) })),
        review.uid,
      );
      if (failed.length > 0) {
        const message = searchFailure(failed, sourceNameIn(deps.sources));
        deps.notify(`Not syncing ${deps.name}: ${message}.`);
        return end({ kind: 'failed', message });
      }
      const still = found.length === 1 && found[0].sourceId === move.from.id && found[0].href === move.location.href;
      if (!still) return { kind: 'stale', reason: 'server' };
    }

    const rename = decision.rename ? renameTo(decision.choices) : undefined;
    const applied = await applySync(review, result(decision.choices), deps.note, syncDeps, {
      rename: rename && !rename.blocked ? rename.to : undefined,
      sourceName: target.name,
    });
    switch (applied.kind) {
      case 'stale':
        return { kind: 'stale', reason: applied.reason };
      case 'failed':
        deps.notify(move ? `Not moved: ${deps.name}: ${applied.message}.` : `Sync failed: ${applied.message}`);
        return end({ kind: 'failed', message: applied.message });
      case 'done':
        if (move) {
          deps.notify(
            applied.oldKept
              ? `Moved ${deps.name} to ${target.name}, but the old copy is still in ${move.from.name}; delete it there by hand.`
              : `Moved ${deps.name} to ${target.name}.`,
          );
        } else if (applied.outcome !== 'failed') {
          deps.notify(`${deps.name}: ${OUTCOME_TEXT[applied.outcome]}${deps.active.length > 1 ? ` (${target.name})` : ''}.`);
        }
        return end(
          applied.oldKept === undefined
            ? { kind: 'done', plan, outcome: applied.outcome }
            : { kind: 'done', plan, outcome: applied.outcome, oldKept: applied.oldKept },
        );
    }
  } finally {
    // UIDs given to linked contact notes while Apply built the card are written (or reported) before going on.
    await contexts.settle();
  }
}
