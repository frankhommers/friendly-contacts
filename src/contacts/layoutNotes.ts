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
  folderNotePath,
  FsStep,
  hasFixedNoteName,
  isInsideOrAt,
  LayoutSettings,
  newContactFolder,
  planIntoFolders,
  planOutOfFolders,
  planRename,
  validateLayout,
} from "src/contacts/layout";
import { linkTarget, linkWithAlias } from "src/contacts/friendly/relations";
import { isContactFrontmatter } from "src/contacts/friendlyNotes";
import { normalizeFolder, planUnitMoves, SkippedMove } from "src/contacts/moveContacts";
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
function otherContactsIn(app: App, folder: TFolder, except?: TFile): TFile[] {
  const found: TFile[] = [];
  const walk = (node: TAbstractFile) => {
    if (node instanceof TFolder) node.children.forEach(walk);
    else if (node !== except && isContactFile(app, node)) found.push(node);
  };
  walk(folder);
  return found;
}

/** The contact notes in the folder at `path` (and its sub-folders); empty when there is no such folder. */
export function contactsInFolder(app: App, path: string): TFile[] {
  const folder = byPath(app, path);
  return folder instanceof TFolder ? otherContactsIn(app, folder) : [];
}

/** The contact's name for `file` in the current layout (the folder's name for a fixed note name such as `index`). */
export function contactNameFor(app: App, file: TFile): string {
  return contactNameOf(file.path, contactsBase(), effectiveLayout(), folderExists(app));
}

/** The name a link to the contact shows: its `name` property, else its contact name in the layout. */
export function contactDisplayName(app: App, file: TFile): string {
  const name: unknown = app.metadataCache.getFileCache(file)?.frontmatter?.name;
  return typeof name === "string" && name.trim() !== "" ? name.trim() : contactNameFor(app, file);
}

/**
 * Link text to a contact note as written into a relationship property, without the brackets. With a fixed note
 * name (`index`) the file name says nothing and is not unique, so the link is always the full path with the contact's
 * name as the alias: `Contacts/Jan de Vries/index|Jan de Vries` (never Obsidian's short `index`, which points at
 * another contact as soon as a second `index.md` exists). Links are compared by `linkTarget`, which drops the alias.
 */
export function contactLinktext(app: App, file: TFile, fromPath: string, omitMdExtension?: boolean): string {
  if (!hasFixedNoteName(effectiveLayout())) return app.metadataCache.fileToLinktext(file, fromPath, omitMdExtension);
  return linkWithAlias(file.path.replace(/\.md$/i, ""), contactDisplayName(app, file));
}

/** A relationship entry that points to a contact about to move, found before the move. */
interface RecordedLink {
  note: TFile;
  property: string;
  /** Position in a list property; -1 for a single value. */
  index: number;
  /** The list's length when recorded: a list that changed meanwhile is left alone. */
  length: number;
  target: TFile;
  /** The alias the entry has, when it is not one of the target's names (the user wrote it). */
  userAlias?: string;
}

function relationProperties(): string[] {
  return getSettings().friendly.mapping.flatMap((row) => (row.kind === "relation" ? [row.property] : []));
}

function aliasOf(entry: string): string | undefined {
  return /^\[\[[^|\]]*\|([^\]]+)\]\]$/.exec(entry)?.[1] ?? /^\[([^\]]*)\]\(/.exec(entry)?.[1];
}

/**
 * Before contacts move (with a fixed note name): every relationship entry in a contact note that points to one of
 * `targets`. Recorded up front because after the move Obsidian may have written the ambiguous short form (`[[index]]`).
 */
export function recordRelationLinks(app: App, targets: TFile[]): RecordedLink[] {
  const wanted = new Set(targets);
  if (wanted.size === 0) return [];
  const names = new Map(
    targets.map((t) => {
      const name: unknown = app.metadataCache.getFileCache(t)?.frontmatter?.name;
      const known = [contactDisplayName(app, t), contactNameFor(app, t), t.basename, typeof name === "string" ? name : ""];
      return [t, new Set(known.map((n) => n.trim().toLowerCase()))] as const;
    }),
  );
  const records: RecordedLink[] = [];
  for (const note of contactsInFolder(app, contactsBase())) {
    const frontmatter = app.metadataCache.getFileCache(note)?.frontmatter ?? {};
    for (const property of relationProperties()) {
      const value: unknown = frontmatter[property];
      const entries = Array.isArray(value) ? value : [value];
      entries.forEach((entry: unknown, i) => {
        if (typeof entry !== "string") return;
        const linkpath = linkTarget(entry.trim()).trim();
        const target = linkpath === "" ? null : app.metadataCache.getFirstLinkpathDest(linkpath, note.path);
        if (!(target instanceof TFile) || !wanted.has(target)) return;
        const alias = aliasOf(entry.trim())?.trim();
        const userAlias = alias !== undefined && !names.get(target)?.has(alias.toLowerCase()) ? alias : undefined;
        records.push({ note, property, index: Array.isArray(value) ? i : -1, length: entries.length, target, userAlias });
      });
    }
  }
  return records;
}

/**
 * After the move: the recorded entries become `[[full/path/index|name]]` with the contact's current name (an alias
 * the user wrote stays). Only relationship properties of contact notes change. Returns the number of entries changed.
 */
export async function rewriteRelationLinks(app: App, records: RecordedLink[]): Promise<number> {
  let count = 0;
  for (const note of new Set(records.map((r) => r.note))) {
    try {
      await app.fileManager.processFrontMatter(note, (fm: Record<string, unknown>) => {
        for (const record of records.filter((r) => r.note === note)) {
          const stem = record.target.path.replace(/\.md$/i, "");
          const link = `[[${linkWithAlias(stem, record.userAlias ?? contactDisplayName(app, record.target))}]]`;
          const value = fm[record.property];
          if (record.index < 0) {
            if (typeof value !== "string" || value === link) continue;
            fm[record.property] = link;
          } else {
            if (!Array.isArray(value) || value.length !== record.length || typeof value[record.index] !== "string") continue;
            if (value[record.index] === link) continue;
            value[record.index] = link;
          }
          count++;
        }
      });
    } catch (error) {
      console.error(`Friendly Contacts: could not update relationship links in ${note.path}`, error);
    }
  }
  return count;
}

/**
 * Why renaming `file`'s contact to `newName` cannot be done, or undefined when it can: a target exists, or the
 * contact's folder holds other contacts (then it is a category, not this person's folder).
 */
export function renameBlocked(app: App, file: TFile, newName: string): string | undefined {
  const plan = planFor(app, file, newName);
  if (plan.skipped !== undefined) {
    return contactFolder(app, file) !== undefined
      ? `A folder or note named "${newName}" already exists.`
      : `A note named "${newName}" already exists in this folder.`;
  }
  return folderMoveProblem(app, file, plan.steps);
}

/** A reason when a folder move in `steps` is not this contact's own folder, or that folder holds other contacts. */
function folderMoveProblem(app: App, file: TFile, steps: FsStep[]): string | undefined {
  const folder = contactFolder(app, file);
  for (const step of steps) {
    if (step.kind !== "move" || step.from === undefined || !(byPath(app, step.from) instanceof TFolder)) continue;
    // Only the folder derived from this note may move, and only when it is this contact's alone.
    if (step.from !== folder) return `Refused to move ${step.from}: it is not this contact's folder.`;
    const others = otherContactsIn(app, byPath(app, folder) as TFolder, file);
    if (others.length > 0) return `${folder} holds other contacts (${others.map((f) => f.basename).join(", ")}); rename it by hand.`;
  }
  return undefined;
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
  const problem = folderMoveProblem(app, file, plan.steps);
  if (problem !== undefined) throw new Error(problem);
  const links = hasFixedNoteName(effectiveLayout()) ? recordRelationLinks(app, [file]) : [];
  try {
    const result = await runSteps(app, plan.steps);
    if (result.failed.length > 0) throw new Error(result.failed.map((f) => f.reason).join("; "));
  } finally {
    await rewriteRelationLinks(app, links);
  }
  return "renamed";
}

/** `kept`: folders a `deleteFolderIfEmpty` step found with other things in them; they stay and are no failure. */
type StepResult = { done: number; failed: { step: FsStep; reason: string }[]; kept: string[] };

/**
 * Applies the steps in order. `steps` is one contact's steps, or a list of them per contact. Before each move the
 * source is looked up again (another plugin may have moved it already): a missing source whose target exists counts
 * as done. A failed step is reported and the rest of that contact's steps are skipped (`an earlier step failed`);
 * other contacts still run. A folder that is not empty when its `deleteFolderIfEmpty` runs is left alone and listed
 * in `kept`.
 */
export async function runSteps(app: App, steps: FsStep[] | FsStep[][]): Promise<StepResult> {
  const groups = (steps.length > 0 && Array.isArray(steps[0]) ? steps : [steps]) as FsStep[][];
  const base = contactsBase();
  const result: StepResult = { done: 0, failed: [], kept: [] };
  for (const group of groups) {
    let stopped = false;
    for (const step of group) {
      if (stopped) {
        result.failed.push({ step, reason: "an earlier step failed" });
        continue;
      }
      const outcome = await runStep(app, step, base);
      if (outcome === undefined) {
        result.done++;
      } else if (typeof outcome === "object") {
        result.kept.push(outcome.kept);
      } else {
        result.failed.push({ step, reason: outcome });
        stopped = true;
      }
    }
  }
  return result;
}

/** Runs one step; undefined when done, a reason when it could not, `{ kept }` for a folder left in place. */
async function runStep(app: App, step: FsStep, base: string): Promise<string | { kept: string } | undefined> {
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
        if (folder.children.length > 0) return { kept: step.to };
        await app.vault.delete(folder);
        return undefined;
      }
    }
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

// ---------- layout commands ----------

export type LayoutDirection = "into" | "out";

export interface LayoutChangeResult {
  /** Contacts that are now in the other layout. */
  moved: number;
  skipped: { path: string; reason: string }[];
  /** Folders that stay because other files are in them. */
  kept: string[];
  /** Contacts that were in the wanted layout already (a re-run); not counted as skipped. */
  alreadyDone: number;
  /** Relationship entries rewritten to full links (fixed note name only). */
  relinked: number;
}

function dirnameOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

/**
 * The folder layout the commands work with, or why there is none. It comes from the stored settings, not from
 * `effectiveLayout`: after switching to one-note layout "take out" still needs the folder note name and location the
 * contacts were created with. "Put in folders" needs the folder layout to be selected.
 */
function commandLayout(direction: LayoutDirection): { s: LayoutSettings } | { problem: string } {
  const stored = getSettings().layout ?? DEFAULT_LAYOUT;
  if (direction === "into" && stored.layout !== "folder") return { problem: "Set the layout to Folder per contact first" };
  const s: LayoutSettings = { ...stored, layout: "folder" };
  const problem = validateLayout(s);
  return problem === undefined ? { s } : { problem: `The folder settings cannot be used: ${problem}` };
}

/** Everything in `folder` and its sub-folders, as paths. */
function descendants(app: App, folder: string): string[] {
  const found: string[] = [];
  const walk = (node: TAbstractFile) => {
    if (!(node instanceof TFolder)) return;
    for (const child of node.children) {
      found.push(child.path);
      walk(child);
    }
  };
  const node = byPath(app, folder);
  if (node) walk(node);
  return found;
}

/** The folder of another contact that `path` lies in (a contact note in someone's folder is its own contact). */
function insideContactFolder(app: App, path: string, s: LayoutSettings, base: string): string | undefined {
  for (let dir = dirnameOf(path); strictlyInside(dir, base); dir = dirnameOf(dir)) {
    const note = folderNotePath(dir, s);
    if (note !== undefined && isContactFile(app, byPath(app, note))) return dir;
  }
  return undefined;
}

interface LayoutPlan {
  /** One group of steps per contact. */
  groups: FsStep[][];
  skipped: { path: string; reason: string }[];
  kept: string[];
  alreadyDone: number;
}

/**
 * Plans moving every contact note in the contacts folder into (`into`) or out of (`out`) its own folder. The name of a
 * contact is derived like everywhere else (`contactNameOf`): the folder's name for a note in its folder, the note's
 * own name otherwise, so "put in folders" uses the note's current name and "take out" the folder's name.
 */
function planLayoutChange(app: App, direction: LayoutDirection): LayoutPlan | { problem: string } {
  const target = commandLayout(direction);
  if ("problem" in target) return target;
  const { s } = target;
  const base = contactsBase();
  const isFolder = folderExists(app);
  const exists = (path: string) => byPath(app, path) !== null;
  const files = contactsInFolder(app, base).sort((a, b) => (a.path < b.path ? -1 : 1));
  const skipped: LayoutPlan["skipped"] = [];
  const notes: { path: string; name: string }[] = [];

  let alreadyDone = 0;
  for (const file of files) {
    const folder = contactFolderOf(file.path, s, isFolder);
    if (direction === "into") {
      if (folder !== undefined) {
        alreadyDone++;
        continue;
      }
      const inside = insideContactFolder(app, file.path, s, base);
      if (inside !== undefined) {
        skipped.push({ path: file.path, reason: `inside the folder of another contact: ${inside}` });
        continue;
      }
    } else if (folder === undefined || !strictlyInside(folder, base)) {
      // Not in a folder of its own (the contacts folder's own note counts as not): nothing to take out.
      alreadyDone++;
      continue;
    }
    notes.push({ path: file.path, name: contactNameOf(file.path, base, s, isFolder) });
  }

  if (direction === "into") {
    const isEmptyFolder = (path: string) => {
      const node = byPath(app, path);
      return node instanceof TFolder && node.children.length === 0;
    };
    const plan = planIntoFolders(notes, s, exists, isEmptyFolder);
    const groups: FsStep[][] = [];
    for (const step of plan.steps) {
      const last = groups[groups.length - 1];
      // A move belongs to the folder step right before it; with a reused empty folder it starts its own group.
      const last2 = last?.[last.length - 1];
      if (step.kind === "move" && last2?.kind === "createFolder" && last.length === 1 && last2.to === dirnameOf(step.to)) last.push(step);
      else groups.push([step]);
    }
    return { groups, skipped: [...skipped, ...plan.skipped], kept: [], alreadyDone };
  }

  const plan = planOutOfFolders(notes, s, exists, (folder) => descendants(app, folder));
  const groups: FsStep[][] = [];
  const groupOfNote = new Map<string, FsStep[]>();
  for (const step of plan.steps) {
    if (step.kind === "move" && step.from !== undefined) {
      const group = [step];
      groups.push(group);
      groupOfNote.set(step.from, group);
    } else if (step.kind === "deleteFolderIfEmpty") {
      // The delete goes with the note of that folder, so it is skipped when that note could not be moved.
      const note = notes.find((n) => contactFolderOf(n.path, s, isFolder) === step.to && groupOfNote.has(n.path));
      if (note) groupOfNote.get(note.path)?.push(step);
      else groups.push([step]);
    }
  }
  return { groups, skipped: [...skipped, ...plan.skipped], kept: plan.kept, alreadyDone };
}

/** Why the command cannot run, or undefined. */
export function layoutCommandProblem(direction: LayoutDirection): string | undefined {
  const target = commandLayout(direction);
  return "problem" in target ? target.problem : undefined;
}

/** How many contacts the command would move now (0 when it cannot run). */
export function layoutChangeCount(app: App, direction: LayoutDirection): number {
  const plan = planLayoutChange(app, direction);
  return "problem" in plan ? 0 : plan.groups.length;
}

/**
 * "Put each contact in its own folder" (`into`) / "Take contacts out of their folders" (`out`). Per contact the
 * steps stop at the first failure. Folders that still hold other files stay, with those files, and are listed in
 * `kept`. Throws with the reason when the layout settings cannot be used.
 */
export async function changeLayout(app: App, direction: LayoutDirection): Promise<LayoutChangeResult> {
  const plan = planLayoutChange(app, direction);
  if ("problem" in plan) throw new Error(plan.problem);
  // With a fixed note name Obsidian writes the moved notes' links as `[[index]]`: record them now, rewrite after.
  const moving = plan.groups.flat().flatMap((step) => {
    const node = step.kind === "move" && step.from !== undefined ? byPath(app, step.from) : null;
    return node instanceof TFile ? [node] : [];
  });
  const fixed = direction === "into" && hasFixedNoteName(getSettings().layout ?? DEFAULT_LAYOUT);
  const links = fixed ? recordRelationLinks(app, moving) : [];
  const result = await runSteps(app, plan.groups);
  const relinked = await rewriteRelationLinks(app, links);
  const skipped = [...plan.skipped];
  let moved = 0;
  const leftovers: FsStep[][] = [];
  for (const group of plan.groups) {
    const failure = result.failed.find((f) => group.includes(f.step));
    if (failure) {
      // The note's path: the source of the group's move (a group of only a folder step names the folder).
      skipped.push({ path: group.find((step) => step.from !== undefined)?.from ?? group[0].to, reason: failure.reason });
      // A folder this run created for the contact stays behind empty: remove it, so a re-run is not blocked.
      const made = group.filter((step) => step.kind === "createFolder" && !result.failed.some((f) => f.step === step));
      leftovers.push(...made.map((step): FsStep[] => [{ kind: "deleteFolderIfEmpty", to: step.to }]));
    } else if (!group.every((step) => step.kind === "deleteFolderIfEmpty" && result.kept.includes(step.to))) {
      moved++;
    }
  }
  if (leftovers.length > 0) await runSteps(app, leftovers);
  return { moved, skipped, kept: [...new Set([...plan.kept, ...result.kept])], alreadyDone: plan.alreadyDone, relinked };
}

/** The Notice after a layout command. */
export function layoutNotice(result: LayoutChangeResult): string {
  return `Moved ${result.moved}, skipped ${result.skipped.length}, kept ${result.kept.length} folders with other files (see console)`;
}

/**
 * Moves the contacts in `files` (all in `from`) to `to`, keeping paths relative to the folder. A contact in its
 * folder moves as a whole with the folder and everything in it; "next to" layout moves the folder and its note
 * together. A contact whose target exists is skipped, never merged. `moved` counts contact notes.
 */
export async function moveContactFolders(
  app: App,
  files: TFile[],
  from: string,
  to: string,
): Promise<{ moved: number; skipped: SkippedMove[] }> {
  const s = effectiveLayout();
  const isFolder = folderExists(app);
  const ownFolder = new Map<string, string>();
  for (const file of files) {
    const folder = contactFolderOf(file.path, s, isFolder);
    if (folder !== undefined && strictlyInside(folder, from)) ownFolder.set(file.path, folder);
  }
  const folders = new Set(ownFolder.values());
  // A folder inside another contact folder travels with it.
  const roots = [...folders].filter((f) => ![...folders].some((other) => other !== f && strictlyInside(f, other)));

  const units = new Map<string, { paths: string[]; count: number }>(roots.map((r) => [r, { paths: [r], count: 0 }]));
  for (const file of files) {
    const root = roots.find((r) => strictlyInside(file.path, r));
    if (root !== undefined) {
      (units.get(root) as { count: number }).count++;
      continue;
    }
    const own = ownFolder.get(file.path);
    const unit = own === undefined ? undefined : units.get(own);
    if (unit) {
      unit.paths.push(file.path); // "next to": the note lies beside its folder
      unit.count++;
    } else {
      units.set(file.path, { paths: [file.path], count: 1 });
    }
  }

  const list = [...units.values()];
  // Never into a contact's own folder (or note): that would nest the contacts in each other, or in themselves.
  const blocking = list.flatMap((u) => u.paths).find((path) => isInsideOrAt(to, path));
  if (blocking !== undefined) {
    const reason = `target is inside a contact's folder: ${blocking}`;
    return { moved: 0, skipped: list.map((u) => ({ from: u.paths[0], reason })) };
  }

  const links = hasFixedNoteName(s) ? recordRelationLinks(app, files) : [];
  const plan = planUnitMoves(list.map((u) => u.paths), from, to, (path) => byPath(app, path) !== null);
  const groups = plan.groups.map((g) =>
    g.moves.flatMap((move): FsStep[] => [
      { kind: "createFolder", to: dirnameOf(move.to) },
      { kind: "move", from: move.from, to: move.to },
    ]),
  );
  const result = await runSteps(app, groups);
  const skipped = [...plan.skipped];
  let moved = 0;
  for (const [i, g] of plan.groups.entries()) {
    const failedAt = groups[i].findIndex((step) => result.failed.some((f) => f.step === step));
    if (failedAt < 0) {
      moved += list[g.unit].count;
      continue;
    }
    const reason = result.failed.find((f) => f.step === groups[i][failedAt])?.reason as string;
    // A contact must not end up split: put back what already moved (best effort).
    const done = groups[i].slice(0, failedAt).filter((step) => step.kind === "move");
    await runSteps(app, [[...done].reverse().map((step): FsStep => ({ kind: "move", from: step.to, to: step.from as string }))]);
    const stuck = done.filter((step) => byPath(app, step.from as string) === null && byPath(app, step.to) !== null);
    const name = list[g.unit].paths[0];
    if (stuck.length === 0) {
      skipped.push({ from: name, reason });
    } else {
      const left = g.moves.filter((m) => !done.some((step) => step.from === m.from));
      const detail = `${stuck.map((step) => `${step.from} moved to ${step.to}`).join(", ")} but ${left.map((m) => `${m.from} stayed`).join(", ")}`;
      skipped.push({ from: name, reason: `SPLIT: ${detail} (${reason}); put them together by hand` });
    }
  }
  await rewriteRelationLinks(app, links);
  return { moved, skipped };
}
