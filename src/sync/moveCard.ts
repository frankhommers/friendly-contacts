/**
 * Moves a card from one address book to another: create in the new one (never overwriting), then delete the
 * old one (only if it is unchanged), then move the sync base. With `deferBase` the sync states are left alone and
 * the new base is returned, for a caller that stores it later (Sync: card, then note, then base).
 * Nothing from obsidian or src/context.
 */

import type { AdapterInterface } from 'src/sync/adapters/adapterInterface';
import type { CardLocation } from 'src/sync/sources';
import { createdBase, describeResponse, succeeded } from 'src/sync/syncContact';
import type { SyncState, SyncStateEntry } from 'src/sync/syncState';
import { cleanUid } from 'src/util/vcard';

export type MoveResult = { ok: true; oldKept: boolean; base?: SyncStateEntry } | { ok: false; message: string };

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export async function moveCard(
  raw: string,
  uid: string,
  from: { adapter: AdapterInterface; state: SyncState; location: CardLocation },
  to: { adapter: AdapterInterface; state: SyncState },
  opts: { deferBase?: boolean } = {},
): Promise<MoveResult> {
  if (!from.location.etag) {
    // Without an ETag the old card cannot be deleted safely; refuse before anything is written.
    return { ok: false, message: 'The server sent no ETag for the old card, so it cannot be deleted safely' };
  }
  const id = cleanUid(uid);

  let created;
  try {
    created = await to.adapter.push({ uid: id, raw }, { ifNoneMatch: true });
  } catch (e) {
    return { ok: false, message: errorText(e) };
  }
  // 412: a card at this href; 409: a card with this UID at another href (CardDAV no-uid-conflict).
  if (created.status === 412 || created.status === 409) {
    return { ok: false, message: 'The address book already has a card with this UID' };
  }
  if (!succeeded(created)) return { ok: false, message: describeResponse(created) };

  // The card now exists in `to`. A failed delete (412: changed in the meantime, or an error) is never retried.
  let oldKept = true;
  try {
    const deleted = await from.adapter.delete(from.location.href, from.location.etag);
    oldKept = !succeeded(deleted);
  } catch {
    oldKept = true;
  }

  const base = await createdBase(to.adapter, id, raw, created);
  if (opts.deferBase) return { ok: true, oldKept, base };
  await to.state.set(uid, base);
  await from.state.remove(uid);
  return { ok: true, oldKept };
}
