import { Notice } from "obsidian";
import { contactNotes, importRemoteCard, relinkImported } from "src/contacts/obsidianNotes";
import { getApp } from "src/context/sharedAppContext";
import type { InsightQueItem } from "src/insights/insight.d";
import { importName } from "src/insights/importList";
import { insightQueueStore } from "src/insights/insightsQueStore";
import { sync } from "src/sync";
import { activeSources } from "src/sync/adapters";
import { uidAlreadyImported } from "src/sync/sources";
import { cleanUid } from "src/util/vcard";

/**
 * `importedNow`: UIDs imported so far in this run; the metadata cache may not show those notes yet.
 * `relinkLater`: the new notes are collected there and relinked once at the end of the run.
 */
interface RunState {
  importedNow: Set<string>;
  relinkLater: { uid: string; path: string }[];
}

/** Imports one card; 'skipped' when its note exists and was kept, so the card stays in the list. */
async function importOne(item: InsightQueItem, state: RunState): Promise<"skipped" | undefined> {
  // The same card can be queued once per address book; a UID that has a note is not imported again.
  const noteUids = contactNotes(getApp()).map((note) => note.uid);
  if (uidAlreadyImported(item.data.uid, noteUids, state.importedNow)) {
    await insightQueueStore.remove(item);
    return undefined;
  }
  const source = activeSources().find((candidate) => candidate.id === item.data.sourceId);
  if (!source) {
    // The address book was removed or disabled since the card was queued.
    await insightQueueStore.remove(item);
    return undefined;
  }
  const rawCard = await sync.pullFromRemote(source, item.data.href);
  if (!rawCard) return undefined; // The reason was shown; the card stays in the list.
  const outcome = await importRemoteCard(getApp(), rawCard, item.data, source, { relinkLater: state.relinkLater });
  if (outcome === "unnamed") console.warn("Skipping contact without name", rawCard.raw);
  if (outcome === "imported") state.importedNow.add(cleanUid(item.data.uid ?? rawCard.uid));
  if (outcome === "skipped") return "skipped";
  await insightQueueStore.remove(item);
  return undefined;
}

/**
 * Imports the queued cards one after the other, then relinks relationships once for everything imported.
 * A card whose note exists and was kept stays in the list; one Notice names how many. Never throws for one card:
 * a card that fails stays in the list and the run goes on.
 */
export async function importQueueItems(items: InsightQueItem[]): Promise<void> {
  const state: RunState = { importedNow: new Set(), relinkLater: [] };
  const skipped: InsightQueItem[] = [];
  for (const item of items) {
    try {
      if ((await importOne(item, state)) === "skipped") skipped.push(item);
    } catch (error) {
      console.error("Friendly Contacts: could not import", item.data, error);
      new Notice(`Could not import ${importName(item.data)}.`);
    }
  }
  await relinkImported(getApp(), state.relinkLater);
  if (skipped.length === 1) {
    new Notice(`${importName(skipped[0].data)} was not imported: a note with that name exists.`);
  } else if (skipped.length > 1) {
    new Notice(`${skipped.length} contacts were not imported: a note with that name exists.`);
  }
}
