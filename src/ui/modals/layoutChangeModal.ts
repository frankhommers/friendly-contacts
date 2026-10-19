import { App, Notice } from "obsidian";
import { changeLayout, layoutChangeCount, layoutCommandProblem, LayoutDirection, layoutNotice } from "src/contacts/layoutNotes";
import type { LayoutSettings } from "src/contacts/layout";
import { insightQueueStore } from "src/insights/insightsQueStore";
import { ConfirmModal } from "src/ui/modals/confirmModal";

/** Runs a layout command and tells the owner what happened; details (skipped notes, kept folders) go to the console. */
export async function runLayoutCommand(app: App, direction: LayoutDirection): Promise<void> {
  const problem = layoutCommandProblem(direction);
  if (problem !== undefined) {
    new Notice(`Friendly Contacts: ${problem}.`);
    return;
  }
  try {
    const result = await changeLayout(app, direction);
    const lines = [
      ...(result.alreadyDone > 0 ? [`${result.alreadyDone} contacts were in this layout already`] : []),
      ...result.skipped.map((s) => `skipped ${s.path}: ${s.reason}`),
      ...result.kept.map((folder) => `kept ${folder}: other files are in it`),
      ...(result.relinked > 0 ? [`${result.relinked} relationship links now name the contact's folder`] : []),
    ];
    if (lines.length > 0) console.log("Friendly Contacts: layout change:\n" + lines.join("\n"));
    if (result.moved > 0) insightQueueStore.clear();
    new Notice(layoutNotice(result));
  } catch (error) {
    console.error("Friendly Contacts: changing the layout failed", error);
    new Notice("Changing the layout failed, see console");
  }
}

/** After the layout setting changed to `to`: offers the command that brings the existing contacts along. */
export function offerLayoutChange(app: App, to: LayoutSettings["layout"]): void {
  const direction: LayoutDirection = to === "folder" ? "into" : "out";
  const count = layoutChangeCount(app, direction);
  if (count === 0) return;
  new ConfirmModal(
    app,
    direction === "into" ? `Put ${count} contacts in their own folder?` : `Take ${count} contacts out of their folders?`,
    direction === "into" ? "Put in folders" : "Take out",
    () => void runLayoutCommand(app, direction),
    "Not now",
  ).open();
}
