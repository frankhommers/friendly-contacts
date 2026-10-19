import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getApp } from "src/context/sharedAppContext";
import { activeSources } from "src/sync/adapters";
import { groupImportItems, importAllQuestion, importRowText } from "src/insights/importList";
import { importQueueItems } from "src/insights/importRun";
import { InsightQueItem } from "src/insights/insight.d";
import { insightService } from "src/insights/insightService";
import { insightQueueStore } from "src/insights/insightsQueStore";
import { useOutsideClickHook } from "src/ui/hooks/outsideClickHook";
import { ConfirmModal } from "src/ui/modals/confirmModal";

/** The processor whose queued cards make up the import list. */
const IMPORT_PROCESSOR = "SyncUnknownProcessor";

type ImportViewProps = {
  setDisplayImportView: (display: boolean) => void;
};

export const ImportView = (props: ImportViewProps) => {
  const [loading, setLoading] = useState(insightService.backgroundProcessRunning.value);
  const [importing, setImporting] = useState(false);
  const [query, setQuery] = useState("");
  /** Bumped whenever the queue changes, so the list is read again. */
  const [version, setVersion] = useState(0);

  const wrapperRef = useRef<HTMLDivElement>(null);
  useOutsideClickHook(wrapperRef, () => {
    // A confirm question is a modal outside the panel; clicking it must not close the panel.
    if (document.querySelector(".modal-container")) return;
    props.setDisplayImportView(false);
  });

  useEffect(() => {
    const unsubscribe = insightService.backgroundProcessRunning.subscribe(setLoading);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    let timeoutId: number | null = null;
    const unsubscribe = insightQueueStore.insightQueItemCount.subscribe(() => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => setVersion((value) => value + 1), 15);
    });
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      unsubscribe();
    };
  }, []);

  const importItems = useMemo(
    () => insightQueueStore.getByName(IMPORT_PROCESSOR),
    [version],
  );
  const groups = useMemo(() => {
    const names = new Map(activeSources().map((source) => [source.id, source.name]));
    return groupImportItems(importItems, (id) => names.get(id), query);
  }, [importItems, query]);
  const visible = groups.flatMap((group) => group.items);

  /** Other insights (the UID processor, when it ever queues something), drawn by the processor itself. */
  const otherGroups = useMemo(() => {
    const result: React.ReactNode[] = [];
    for (const processorName of insightQueueStore.getProcessorsInStore()) {
      if (processorName === IMPORT_PROCESSOR) continue;
      const processor = insightService.getProcessorByName(processorName);
      const queItems = insightQueueStore.getByName(processorName);
      if (!processor || queItems.length === 0) continue;
      result.push(<React.Fragment key={processorName}>{processor.renderGroup({ queItems })}</React.Fragment>);
    }
    return result;
  }, [version]);

  async function runImport(items: InsightQueItem[]) {
    if (importing || items.length === 0) return;
    setImporting(true);
    try {
      await importQueueItems(items);
    } finally {
      setImporting(false);
      setVersion((value) => value + 1);
    }
  }

  function confirmImportAll() {
    const items = visible;
    if (items.length === 0 || importing) return;
    new ConfirmModal(getApp(), importAllQuestion(items.length, groups.length), "Import all", () => {
      void runImport(items);
    }).open();
  }

  return (
    <div ref={wrapperRef} className="contacts-view import-panel">
      <div className="import-panel-header">
        <div className="import-panel-count">
          <span>{visible.length} {visible.length === 1 ? "contact" : "contacts"}</span>
        </div>
        <button
          className="import-panel-button mod-cta"
          disabled={importing || visible.length === 0}
          onClick={confirmImportAll}>
          Import all
        </button>
        <div className="contacts-view-close">
          <div className="modal-close-button" onClick={() => props.setDisplayImportView(false)}></div>
        </div>
      </div>
      <div className="import-panel-search">
        <input
          type="search"
          autoFocus
          placeholder="Search by name or organisation"
          aria-label="Search contacts to import"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {loading ? (
        <div className="progress-bar progress-bar--contacts">
          <div className="progress-bar-message u-center-text">Looking for contacts to import...</div>
          <div className="progress-bar-indicator">
            <div className="progress-bar-line"></div>
            <div className="progress-bar-subline mod-increase"></div>
            <div className="progress-bar-subline mod-decrease"></div>
          </div>
        </div>
      ) : null}

      {!loading && importItems.length === 0 && otherGroups.length === 0 ? (
        <div className="action-card">
          <div className="action-card-content action-card-content--no-height">
            <p>Nothing to import. Every contact on your address books has a note.</p>
          </div>
        </div>
      ) : null}

      {!loading && importItems.length > 0 && visible.length === 0 ? (
        <div className="action-card">
          <div className="action-card-content action-card-content--no-height">
            <p>No contacts match your search.</p>
          </div>
        </div>
      ) : null}

      {!loading ? groups.map((group) => (
        <div key={group.sourceId} className="import-book">
          <div className="import-book-header">
            <span className="import-book-name">{group.name} ({group.items.length})</span>
            <button
              className="import-panel-button"
              disabled={importing}
              onClick={() => void runImport(group.items)}>
              Import all
            </button>
          </div>
          {group.items.map((queItem) => (
            <div key={`${queItem.data.sourceId}:${queItem.data.uid ?? queItem.data.href}`} className="import-row">
              <span className="import-row-text">{importRowText(queItem.data)}</span>
              <button
                className="import-panel-button"
                disabled={importing}
                onClick={() => void runImport([queItem])}>
                Import
              </button>
              <div
                className="modal-close-button import-row-hide"
                tabIndex={0}
                role="button"
                aria-label="Hide"
                onClick={async () => {
                  await insightQueueStore.dismissItem(queItem);
                  setVersion((value) => value + 1);
                }}>
              </div>
            </div>
          ))}
        </div>
      )) : null}

      {!loading && otherGroups.length > 0 ? (
        <div className="import-other">
          <div className="import-book-header">
            <span className="import-book-name">Other</span>
          </div>
          {otherGroups}
        </div>
      ) : null}
    </div>
  );
};
