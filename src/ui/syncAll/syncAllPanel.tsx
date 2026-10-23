/**
 * The Sync all worklist: the contacts that differ on the left, the review of the selected one on the right
 * (today's `SyncReviewContent`, its picks held by the model), "Apply all that are ready" at the bottom.
 */

import { Notice } from 'obsidian';
import * as React from 'react';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Badge, SyncAll, SyncAllItem } from 'src/sync/syncAll';
import { SyncReviewContent, SyncReviewInput } from 'src/ui/modals/syncReviewModal';

type ServerOnly = SyncReviewInput['serverOnly'];

export type SyncAllModel = Pick<
  SyncAll,
  'state' | 'subscribe' | 'scan' | 'setChoices' | 'setRename' | 'refresh' | 'apply' | 'readyPaths' | 'applyAllReady'
>;

export interface SyncAllPanelProps {
  model: SyncAllModel;
  linkName(link: string): string;
  /** The server-only relationship targets of a note's review (loaded when the note is selected). */
  serverOnly(path: string): Promise<ServerOnly>;
}

type Listed = Extract<SyncAllItem, { kind: 'review' | 'done' }>;
type ReviewItem = Extract<SyncAllItem, { kind: 'review' }>;

const NO_SERVER_ONLY: ServerOnly = () => [];

function badgeText(badge: Badge, serverName: string): string {
  switch (badge) {
    case 'conflict':
      return 'Conflict';
    case 'server':
      return `From ${serverName}`;
    case 'obsidian':
      return 'From Obsidian';
    case 'newCard':
      return 'New card';
  }
}

const isListed = (item: SyncAllItem): item is Listed => item.kind === 'review' || item.kind === 'done';
const isReview = (item: SyncAllItem): item is ReviewItem => item.kind === 'review';
const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** A number per review request, so the review content starts afresh (Show all, Import) when its data changes. */
const requestIds = new WeakMap<object, number>();
let lastRequestId = 0;
function requestId(request: object): number {
  let id = requestIds.get(request);
  if (id === undefined) {
    id = ++lastRequestId;
    requestIds.set(request, id);
  }
  return id;
}

export const SyncAllPanel: React.FC<SyncAllPanelProps> = ({ model, linkName, serverOnly }) => {
  const subscribe = useCallback((listener: () => void) => model.subscribe(listener), [model]);
  const state = useSyncExternalStore(subscribe, () => model.state);
  const { items, busy } = state;
  const [selected, setSelected] = useState<string | undefined>();

  const listed = items.filter(isListed);
  const blocked = items.filter((item): item is Extract<SyncAllItem, { kind: 'blocked' }> => item.kind === 'blocked');
  const upToDate = items.filter((item) => item.kind === 'upToDate').length;
  const done = listed.filter((item) => item.kind === 'done').length;
  const ready = model.readyPaths().length;

  // The selected row; the first review item when nothing (or no longer listed) is.
  const current = listed.find((item) => item.path === selected) ?? listed.find(isReview);
  const position = current ? listed.indexOf(current) : -1;
  const previous = position < 0 ? undefined : listed.slice(0, position).reverse().find(isReview);
  const next = position < 0 ? undefined : listed.slice(position + 1).find(isReview);
  const request = current?.kind === 'review' ? current.request : undefined;

  // The server-only lookup of the selected review, loaded again when its data changes (say after an Import).
  const [lookup, setLookup] = useState<{ request: object; serverOnly: ServerOnly }>();
  const currentPath = current?.path;
  useEffect(() => {
    if (currentPath === undefined || request === undefined) return;
    let live = true;
    serverOnly(currentPath).then(
      (found) => {
        if (live) setLookup({ request, serverOnly: found });
      },
      (error) => console.error('Sync all: looking up server-only contacts failed', error),
    );
    return () => {
      live = false;
    };
  }, [currentPath, request, serverOnly]);
  const shownServerOnly = lookup && lookup.request === request ? lookup.serverOnly : NO_SERVER_ONLY;

  const input = useMemo<SyncReviewInput | undefined>(
    () => (request ? { ...request, serverOnly: shownServerOnly } : undefined),
    [request, shownServerOnly],
  );

  const scanAgain = () => {
    model.scan().catch((error) => new Notice(`Sync all failed: ${errorText(error)}`));
  };

  const apply = async (path: string) => {
    await model.apply(path);
    const after = model.state.items;
    if (after.find((item) => item.path === path)?.kind === 'review') return;
    // Applied (or it cannot be synced now): on to the next review item, unless another one was picked meanwhile.
    const at = after.findIndex((item) => item.path === path);
    const following = after.slice(at + 1).find(isReview) ?? after.find(isReview);
    setSelected((now) => (now === undefined || now === path ? following?.path : now));
  };

  const applyAll = async () => {
    const { applied, changed, failed } = await model.applyAllReady();
    let message = `Applied ${applied}`;
    if (changed > 0) message += `, ${changed} changed since the scan`;
    if (failed > 0) message += `, ${failed} failed`;
    new Notice(message);
    if (current && model.state.items.find((item) => item.path === current.path)?.kind !== 'review') setSelected(undefined);
  };

  const onListKey = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const to = listed[position + (event.key === 'ArrowDown' ? 1 : -1)];
    if (to) setSelected(to.path);
  };

  const renderRow = (item: Listed) => {
    const isCurrent = item === current;
    const classes = ['friendly-sync-all-row'];
    if (isCurrent) classes.push('is-selected');
    if (item.kind === 'done') classes.push('is-done');
    return (
      <li
        key={item.path}
        className={classes.join(' ')}
        role="option"
        aria-selected={isCurrent}
        onClick={() => setSelected(item.path)}
      >
        <span className="friendly-sync-all-name">
          {item.kind === 'done' ? '✓ ' : null}
          {item.name}
        </span>
        {item.kind === 'review'
          ? item.badges.map((badge) => (
              <span key={badge} className={`friendly-sync-all-badge is-${badge}`}>
                {badgeText(badge, item.request.serverName)}
              </span>
            ))
          : null}
      </li>
    );
  };

  const renderDetail = () => {
    if (!current) return <p className="friendly-sync-all-empty">{busy === 'scan' ? '' : 'Nothing to review.'}</p>;
    const messages = current.messages.length > 0 || current.kind === 'review' ? current.messages : ['Done.'];
    return (
      <>
        <h3 className="friendly-sync-all-title">{current.name}</h3>
        {current.kind === 'review' && current.request.title !== current.name ? (
          <div className="friendly-sync-all-subtitle">{current.request.title}</div>
        ) : null}
        {messages.length > 0 ? (
          <div className="friendly-sync-all-messages">
            {messages.map((message, i) => (
              <p key={i}>{message}</p>
            ))}
          </div>
        ) : null}
        {current.kind === 'review' && input ? (
          <SyncReviewContent
            key={`${current.path}#${requestId(current.request)}`}
            input={input}
            linkName={linkName}
            choices={current.choices}
            onChoicesChange={(choices) => model.setChoices(current.path, choices)}
            rename={current.rename}
            onRenameChange={(rename) => model.setRename(current.path, rename)}
            onApply={() => void apply(current.path)}
            onImported={() => void model.refresh(current.path)}
            disabled={busy !== undefined}
            extraButtons={
              <>
                <button disabled={!previous} onClick={() => previous && setSelected(previous.path)}>
                  Previous
                </button>
                <button disabled={!next} onClick={() => next && setSelected(next.path)}>
                  Next
                </button>
              </>
            }
          />
        ) : null}
      </>
    );
  };

  return (
    <div className="friendly-sync-all">
      <div className="friendly-sync-all-top">
        <span className="friendly-sync-all-status">
          {busy === 'scan' ? `Scanning ${state.scanned} of ${state.total}…` : `${upToDate} up to date`}
        </span>
        <button disabled={busy !== undefined} onClick={scanAgain}>
          Scan again
        </button>
      </div>
      <div className="friendly-sync-all-main">
        <div className="friendly-sync-all-list">
          {listed.length > 0 ? (
            <ul role="listbox" aria-label="Contacts that differ" tabIndex={0} onKeyDown={onListKey}>
              {listed.map(renderRow)}
            </ul>
          ) : busy === 'scan' || blocked.length > 0 ? null : (
            <p className="friendly-sync-all-empty">Every contact is in sync.</p>
          )}
          {blocked.length > 0 ? (
            <div className="friendly-sync-all-blocked">
              <h4>Cannot be synced</h4>
              <ul>
                {blocked.map((item) => (
                  <li key={item.path}>
                    <span className="friendly-sync-all-name">{item.name}</span>
                    <span className="friendly-sync-all-reason">{item.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <div className="friendly-sync-all-detail">{renderDetail()}</div>
      </div>
      <div className="friendly-sync-all-bottom">
        <span className="friendly-sync-all-progress">
          {done} of {listed.length} done
        </span>
        <button className="mod-cta" disabled={ready === 0 || busy !== undefined} onClick={() => void applyAll()}>
          Apply all that are ready ({ready})
        </button>
      </div>
    </div>
  );
};
