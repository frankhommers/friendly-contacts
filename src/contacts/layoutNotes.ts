/**
 * Runs the layout model (src/contacts/layout.ts) against the vault: where new contacts go, renaming a contact with
 * its folder, and executing filesystem steps. Renames and moves go through `app.fileManager.renameFile` (links
 * update); only empty folders are deleted; existing targets are skipped and reported, never overwritten.
 */
import { App, Notice, TAbstractFile, TFile, TFolder } from "obsidian";
import {
  contactFolderOf,
  contactNameOf,
  contactPaths,
  DEFAULT_LAYOUT,
  FsStep,
  isInsideOrAt,
  LayoutSettings,
  newContactFolder,
  planRename,
  validateLayout,
} from "src/contacts/layout";
import { isContactFrontmatter } from "src/contacts/friendlyNotes";
import { normalizeFolder } from "src/contacts/moveContacts";
import { getSettings } from "src/context/sharedSettingsContext";

let warnedAbout: string | undefined;

/** For tests: the invalid-layout Notice may show again. */
export function resetLayoutWarning(): void {
  warnedAbout = undefined;
}

/**
 * The layout to work with. Folder layout with settings that do not validate is used as one note per contact,
 * with a Notice once (per problem) so the owner knows why.
 */
export function effectiveLayout(): LayoutSettings {
  const layout = getSettings().layout ?? DEFAULT_LAYOUT;
  if (layout.layout !== "folder") return layout;
  const problem = validateLayout(layout);
  if (problem === undefined) return layout;
  if (warnedAbout !== problem) {
    warnedAbout = problem;
    new Notice(`Friendly Contacts: folder per contact is off until its settings are fixed: ${problem}.`);
  }
  return { ...layout, layout: "note" };
}

function contactsBase(): string {
  return normalizeFolder(getSettings().contactsFolder ?? "");
}

function byPath(app: App, path: string): TAbstractFile | null {
  return app.vault.getAbstractFileByPath(path === "" ? "/" : path);
}

function folderExists(app: App): (path: string) => boolean {
  return (path) => byPath(app, path) instanceof TFolder;
}

function isContactFile(app: App, file: TAbstractFile | null): file is TFile {
  if (!(file instanceof TFile)) return false;
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
  return !!frontmatter && isContactFrontmatter(frontmatter);
}

/** True when `path` lies strictly inside `folder` (the vault root '' holds every other path). */
function strictlyInside(path: string, folder: string): boolean {
  return path !== folder && isInsideOrAt(path, folder);
}

/**
 * The folder and note for a new contact named `name` (its file name, without `.md`). It goes in the active note's
 * folder when that is inside the contacts folder, else in the contacts folder; in folder layout never inside
 * another contact's folder.
 */
export function newContactLocation(app: App, name: string, baseFolder: string = contactsBase()): { folder?: string; note: string } {
  const s = effectiveLayout();
  const parent = app.workspace.getActiveFile()?.parent;
  const activeFolder = parent ? (parent.isRoot() ? "" : parent.path) : undefined;
  const folder = newContactFolder(baseFolder, activeFolder, s, (path) => isContactFile(app, byPath(app, path)));
  return contactPaths(folder, name, s);
}

/** Creates `path` as a folder (and missing parents); fine when it is a folder already. */
export async function ensureFolder(app: App, path: string): Promise<void> {
  let current = "";
  for (const part of normalizeFolder(path).split("/").filter(Boolean)) {
    current = current === "" ? part : `${current}/${part}`;
    const existing = byPath(app, current);
    if (existing instanceof TFolder) continue;
    if (existing) throw new Error(`${current} is a file, not a folder`);
    try {
      await app.vault.createFolder(current);
    } catch (error) {
      if (!(byPath(app, current) instanceof TFolder)) throw error; // "already exists" is fine
    }
  }
}

/** Every contact note in `folder` and its sub-folders other than `except`. */
function otherContactsIn(app: App, folder: TFolder, except: TFile): TFile[] {
  const found: TFile[] = [];
  const walk = (node: TAbstractFile) => {
    if (node instanceof TFolder) node.children.forEach(walk);
    else if (node !== except && isContactFile(app, node)) found.push(node);
  };
  walk(folder);
  return found;
}

/** The contact's name for `file` in the current layout (the folder's name for a fixed note name such as `index`). */
export function contactNameFor(app: App, file: TFile): string {
  return contactNameOf(file.path, contactsBase(), effectiveLayout(), folderExists(app));
}

/** True when renaming `file`'s contact to `newName` would land on something that exists. */
export function renameTaken(app: App, file: TFile, newName: string): boolean {
  return planFor(app, file, newName).skipped !== undefined;
}

/** True when renaming `file`'s contact renames its folder too (the note is in its own folder). */
export function renamesFolder(app: App, file: TFile): boolean {
  return contactFolder(app, file) !== undefined;
}

/** The note's own folder when it has one that may be renamed: strictly inside the contacts folder. */
function contactFolder(app: App, file: TFile): string | undefined {
  const s = effectiveLayout();
  const folder = contactFolderOf(file.path, s, folderExists(app));
  return folder !== undefined && strictlyInside(folder, contactsBase()) ? folder : undefined;
}

function planFor(app: App, file: TFile, newName: string): { steps: FsStep[]; skipped?: string } {
  const s = effectiveLayout();
  const exists = (path: string) => byPath(app, path) !== null;
  // A note that is not in a folder of its own below the contacts folder (e.g. `Contacts/Contacts.md`) is renamed as
  // a single note: the contacts folder, or anything above it, never moves.
  const asNote = s.layout === "folder" && contactFolder(app, file) === undefined;
  return planRename(file.path, newName, asNote ? { ...s, layout: "note" } : s, exists);
}

/**
 * Renames a contact to `newName` in the layout: its folder (when the note is in one) and its note. 'exists' when a
 * target is taken (nothing moved). Throws when a step fails or the folder holds other contacts.
 */
export async function renameContact(app: App, file: TFile, newName: string): Promise<"renamed" | "exists"> {
  const plan = planFor(app, file, newName);
  if (plan.skipped !== undefined) return "exists";
  const folder = contactFolder(app, file);
  for (const step of plan.steps) {
    if (step.kind !== "move" || step.from === undefined || !(byPath(app, step.from) instanceof TFolder)) continue;
    // Only the folder derived from this note may move, and only when it is this contact's alone.
    if (step.from !== folder) throw new Error(`refused to move ${step.from}: it is not this contact's folder`);
    const others = otherContactsIn(app, byPath(app, folder) as TFolder, file);
    if (others.length > 0) {
      throw new Error(`${folder} holds other contacts (${others.map((f) => f.basename).join(", ")}); rename it by hand`);
    }
  }
  const result = await runSteps(app, plan.steps);
  if (result.failed.length > 0) throw new Error(result.failed.map((f) => f.reason).join("; "));
  return "renamed";
}

function under(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`);
}

/**
 * Applies the steps in order. Before each move the source is looked up again (another plugin may have moved it
 * already): a missing source whose target exists counts as done. A failed step is reported and every later step
 * that touches its paths is skipped (the rest of that contact); independent steps still run.
 */
export async function runSteps(
  app: App,
  steps: FsStep[],
): Promise<{ done: number; failed: { step: FsStep; reason: string }[] }> {
  const base = contactsBase();
  const failed: { step: FsStep; reason: string }[] = [];
  const blocked: string[] = [];
  let done = 0;

  for (const step of steps) {
    const paths = [step.from, step.to].filter((p): p is string => p !== undefined);
    // Depends on a failed step: it works on (or inside) a path that step left as it was; deleting a folder also
    // depends on what was to leave it.
    const dependent =
      paths.some((p) => blocked.some((b) => under(p, b))) ||
      (step.kind === "deleteFolderIfEmpty" && blocked.some((b) => under(b, step.to)));
    if (dependent) {
      failed.push({ step, reason: "an earlier step failed" });
      continue;
    }
    const reason = await runStep(app, step, base);
    if (reason === undefined) {
      done++;
    } else {
      failed.push({ step, reason });
      blocked.push(...paths);
    }
  }
  return { done, failed };
}

/** Runs one step; a reason when it could not. */
async function runStep(app: App, step: FsStep, base: string): Promise<string | undefined> {
  try {
    switch (step.kind) {
      case "createFolder": {
        const existing = byPath(app, step.to);
        if (existing instanceof TFolder) return undefined;
        if (existing) return `target exists: ${step.to}`;
        await ensureFolder(app, step.to);
        return undefined;
      }
      case "move": {
        if (step.from === undefined) return "nothing to move";
        // The contacts folder, or a folder holding it, never moves.
        if (isInsideOrAt(base, step.from)) return `refused: ${step.from} is the contacts folder`;
        const source = byPath(app, step.from);
        const target = byPath(app, step.to);
        if (!source) return target ? undefined : `missing: ${step.from}`;
        // A case-only rename finds the source itself on a case-insensitive vault; that is no other file.
        if (target && target !== source) return `target exists: ${step.to}`;
        await app.fileManager.renameFile(source, step.to);
        return undefined;
      }
      case "deleteFolderIfEmpty": {
        if (isInsideOrAt(base, step.to)) return `refused: ${step.to} is the contacts folder`;
        const folder = byPath(app, step.to);
        if (!folder) return undefined;
        if (!(folder instanceof TFolder)) return `not a folder: ${step.to}`;
        if (folder.children.length > 0) return `not empty: ${step.to}`;
        await app.vault.delete(folder);
        return undefined;
      }
    }
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
