/**
 * Pure model for "folder per contact": where a contact's folder and note live, and the filesystem steps to get there.
 * No Obsidian imports. Paths are vault-relative with `/`, no leading slash; the vault root is ''.
 */
import { join, normalizeFolder } from "src/contacts/moveContacts";

export interface LayoutSettings {
  layout: "note" | "folder";
  /** Pattern for the folder note's file name, without `.md`; `{{name}}` is the contact's file name. */
  noteName: string;
  location: "inside" | "next";
}

export const DEFAULT_LAYOUT: LayoutSettings = { layout: "note", noteName: "{{name}}", location: "inside" };

const NAME_TOKEN = "{{name}}";

/** Stored layout settings with every missing or unknown value replaced by its default. */
export function normalizeLayout(raw: unknown): LayoutSettings {
  const r = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    layout: r.layout === "note" || r.layout === "folder" ? r.layout : DEFAULT_LAYOUT.layout,
    noteName: typeof r.noteName === "string" ? r.noteName : DEFAULT_LAYOUT.noteName,
    location: r.location === "inside" || r.location === "next" ? r.location : DEFAULT_LAYOUT.location,
  };
}

export interface FsStep {
  kind: "createFolder" | "move" | "deleteFolderIfEmpty";
  from?: string;
  to: string;
}

// ---------- path helpers ----------

function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function basenameNoExt(path: string): string {
  const name = fileName(path);
  return name.toLowerCase().endsWith(".md") ? name.slice(0, -3) : name;
}

function sameIgnoringCase(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

// ---------- settings ----------

/** A message when the settings cannot be used, otherwise undefined. */
export function validateLayout(s: LayoutSettings): string | undefined {
  const pattern = s.noteName.trim();
  if (pattern === "") return "The folder note name is empty";
  if (/\.md$/i.test(pattern)) return "Leave out .md, it is added for you";
  const placeholders = pattern.match(/\{\{[^}]*\}\}/g) ?? [];
  if (placeholders.some((p) => p !== NAME_TOKEN)) return `Only ${NAME_TOKEN} can be used in the folder note name`;
  const sample = pattern.split(NAME_TOKEN).join("x");
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(sample)) return 'The folder note name cannot contain \\ / : * ? " < > |';
  if (sample.startsWith(".") || /[. ]$/.test(sample)) {
    return "The folder note name cannot start with a dot or end with a dot or space";
  }
  if (s.location === "next" && !pattern.includes(NAME_TOKEN)) {
    return `"Next to the folder" needs ${NAME_TOKEN} in the folder note name, or every contact gets the same file name`;
  }
  return undefined;
}

/** True in folder layout when every contact's note has the same file name (a pattern without `{{name}}`). */
export function hasFixedNoteName(s: LayoutSettings): boolean {
  return s.layout === "folder" && !s.noteName.includes(NAME_TOKEN);
}

/**
 * The note's file name without `.md`. In one-note layout that is the contact name; in folder layout the pattern
 * with `{{name}}` replaced.
 */
export function noteBasename(name: string, s: LayoutSettings): string {
  if (s.layout === "note") return name;
  return s.noteName.trim().split(NAME_TOKEN).join(name);
}

/** Where a new contact goes: its folder (folder layout only) and its note. */
export function contactPaths(baseFolder: string, name: string, s: LayoutSettings): { folder?: string; note: string } {
  const base = normalizeFolder(baseFolder);
  if (s.layout === "note") return { note: join(base, `${name}.md`) };
  const basename = noteBasename(name, s);
  if (s.location === "inside") {
    const folder = join(base, name);
    return { folder, note: join(folder, `${basename}.md`) };
  }
  // next to: the folder is named like the note
  return { folder: join(base, basename), note: join(base, `${basename}.md`) };
}

/**
 * The folder belonging to a contact note, derived from its path; undefined when the note is not in its folder.
 * inside: the parent folder is named like the contact and the note is named by the pattern.
 * next: a sibling folder named like the note exists.
 */
export function contactFolderOf(
  notePath: string,
  s: LayoutSettings,
  folderExists: (path: string) => boolean,
): string | undefined {
  if (s.layout !== "folder") return undefined;
  const dir = dirname(notePath);
  const basename = basenameNoExt(notePath);
  if (s.location === "inside") {
    if (dir === "") return undefined;
    return noteBasename(fileName(dir), s) === basename ? dir : undefined;
  }
  const folder = join(dir, basename);
  return folderExists(folder) ? folder : undefined;
}

/** True when `path` is `folder` itself or lies inside it; the vault root ('') holds everything. */
export function isInsideOrAt(path: string, folder: string): boolean {
  return folder === "" || path === folder || path.startsWith(`${folder}/`);
}

/**
 * The note that makes `folder` a contact's folder in this layout: inside, the note named by the pattern for the
 * folder's name; next, the note named like the folder next to it. Undefined in one-note layout or for the vault root.
 */
export function folderNotePath(folder: string, s: LayoutSettings): string | undefined {
  if (s.layout !== "folder" || folder === "") return undefined;
  return s.location === "inside" ? join(folder, `${noteBasename(fileName(folder), s)}.md`) : `${folder}.md`;
}

/**
 * The folder a new contact goes in: the active note's folder when that lies inside the contacts folder, else the
 * contacts folder. In folder layout never inside a contact's folder: then the parent of the outermost one.
 * `isContactNote(path)` says whether a contact note exists at that path.
 */
export function newContactFolder(
  baseFolder: string,
  activeFolder: string | undefined,
  s: LayoutSettings,
  isContactNote: (path: string) => boolean,
): string {
  const base = normalizeFolder(baseFolder);
  const active = activeFolder === undefined ? undefined : normalizeFolder(activeFolder);
  if (active === undefined || !isInsideOrAt(active, base)) return base;
  if (s.layout !== "folder") return active;
  let result = active;
  for (let folder = active; folder !== base && folder !== ""; folder = dirname(folder)) {
    const note = folderNotePath(folder, s);
    if (note !== undefined && isContactNote(note)) result = dirname(folder);
  }
  return result;
}

/**
 * The contact's name for a note: the folder's name (inside) or the note's name without the pattern around
 * `{{name}}` (next) when the note is in its folder below `baseFolder`; otherwise the note's file name.
 */
export function contactNameOf(
  notePath: string,
  baseFolder: string,
  s: LayoutSettings,
  folderExists: (path: string) => boolean,
): string {
  const basename = basenameNoExt(notePath);
  const folder = contactFolderOf(notePath, s, folderExists);
  const base = normalizeFolder(baseFolder);
  if (folder === undefined || folder === base || !isInsideOrAt(folder, base)) return basename;
  if (s.location === "inside") return fileName(folder);
  const parts = s.noteName.trim().split(NAME_TOKEN);
  if (parts.length !== 2) return basename;
  const [prefix, suffix] = parts;
  const ok = basename.length > prefix.length + suffix.length && basename.startsWith(prefix) && basename.endsWith(suffix);
  return ok ? basename.slice(prefix.length, basename.length - suffix.length) : basename;
}

// ---------- planning ----------

/** Plans the renames for a contact getting `newName`; each step is valid after the steps before it. */
export function planRename(
  notePath: string,
  newName: string,
  s: LayoutSettings,
  exists: (path: string) => boolean,
): { steps: FsStep[]; skipped?: string } {
  const steps: FsStep[] = [];
  const taken = (path: string) => `target exists: ${path}`;
  const dir = dirname(notePath);
  const base = basenameNoExt(notePath);

  const renameNoteOnly = (): { steps: FsStep[]; skipped?: string } => {
    const target = join(dir, `${newName}.md`);
    if (target === notePath) return { steps };
    if (!sameIgnoringCase(target, notePath) && exists(target)) return { steps: [], skipped: taken(target) };
    return { steps: [{ kind: "move", from: notePath, to: target }] };
  };

  if (s.layout === "note") return renameNoteOnly();

  const newBase = noteBasename(newName, s);

  if (s.location === "inside") {
    const folderName = fileName(dir);
    // In its folder when the folder is already named for the new name (renamed from outside, e.g. by Folder Notes)
    // or the note's name is what the pattern gives for the folder's name. Otherwise it is a one-note contact.
    const inFolder = dir !== "" && (folderName === newName || noteBasename(folderName, s) === base);
    if (!inFolder) return renameNoteOnly();

    const folderTarget = join(dirname(dir), newName);
    let currentNote = notePath;
    if (folderTarget !== dir) {
      if (!sameIgnoringCase(folderTarget, dir) && exists(folderTarget)) return { steps: [], skipped: taken(folderTarget) };
      steps.push({ kind: "move", from: dir, to: folderTarget });
      currentNote = join(folderTarget, `${base}.md`);
    }
    const noteTarget = join(folderTarget, `${newBase}.md`);
    if (currentNote !== noteTarget) {
      if (!sameIgnoringCase(currentNote, noteTarget) && exists(noteTarget)) return { steps: [], skipped: taken(noteTarget) };
      steps.push({ kind: "move", from: currentNote, to: noteTarget });
    }
    return { steps };
  }

  // next to: the folder is a sibling named like the note
  const oldFolder = join(dir, base);
  const folderTarget = join(dir, newBase);
  const noteTarget = join(dir, `${newBase}.md`);
  if (folderTarget !== oldFolder && exists(oldFolder)) {
    if (!sameIgnoringCase(folderTarget, oldFolder) && exists(folderTarget)) return { steps: [], skipped: taken(folderTarget) };
    steps.push({ kind: "move", from: oldFolder, to: folderTarget });
  }
  if (noteTarget !== notePath) {
    if (!sameIgnoringCase(noteTarget, notePath) && exists(noteTarget)) return { steps: [], skipped: taken(noteTarget) };
    steps.push({ kind: "move", from: notePath, to: noteTarget });
  }
  return { steps };
}

/**
 * For notes in one-note layout: create each contact's folder and put the note in the layout. A folder that exists
 * and is empty (`isEmptyFolder`, e.g. left by an earlier run that failed half way) is used as it is.
 */
export function planIntoFolders(
  notes: { path: string; name: string }[],
  s: LayoutSettings,
  exists: (path: string) => boolean,
  isEmptyFolder: (path: string) => boolean = () => false,
): { steps: FsStep[]; skipped: { path: string; reason: string }[] } {
  const steps: FsStep[] = [];
  const skipped: { path: string; reason: string }[] = [];
  const invalid = s.layout !== "folder" ? "layout is one note per contact" : validateLayout(s);
  if (invalid) return { steps, skipped: notes.map((n) => ({ path: n.path, reason: invalid })) };

  const claimed = new Map<string, string>(); // folder (lower case) -> note path that takes it
  for (const note of notes) {
    const paths = contactPaths(dirname(note.path), note.name, s);
    const folder = paths.folder as string;
    if (contactFolderOf(note.path, s, exists) !== undefined) {
      skipped.push({ path: note.path, reason: "already in its folder" });
      continue;
    }
    const other = claimed.get(folder.toLowerCase());
    if (other !== undefined) {
      skipped.push({ path: note.path, reason: `same folder as ${other}: ${folder}` });
      continue;
    }
    const reuse = exists(folder) && isEmptyFolder(folder);
    if (exists(folder) && !reuse) {
      skipped.push({ path: note.path, reason: `folder exists: ${folder}` });
      continue;
    }
    if (paths.note !== note.path && exists(paths.note)) {
      skipped.push({ path: note.path, reason: `target exists: ${paths.note}` });
      continue;
    }
    claimed.set(folder.toLowerCase(), note.path);
    if (!reuse) steps.push({ kind: "createFolder", to: folder });
    if (paths.note !== note.path) steps.push({ kind: "move", from: note.path, to: paths.note });
  }
  return { steps, skipped };
}

/**
 * For notes in their folders: move each note out next to its folder (`<parent>/<name>.md`), then delete the folder
 * when nothing else is in it. `folderFiles(folder)` lists everything in the folder (files and sub-folders; the note
 * itself may be included). Folders that still hold other things are listed in `kept`.
 */
export function planOutOfFolders(
  notes: { path: string; name: string }[],
  s: LayoutSettings,
  exists: (path: string) => boolean,
  folderFiles: (folder: string) => string[],
): { steps: FsStep[]; kept: string[]; skipped: { path: string; reason: string }[] } {
  const steps: FsStep[] = [];
  const kept: string[] = [];
  const skipped: { path: string; reason: string }[] = [];
  const leaving = new Set<string>(); // note paths that leave their folder
  const folders = new Set<string>();
  const targets = new Set<string>();

  for (const note of notes) {
    const folder = contactFolderOf(note.path, s, exists);
    if (folder === undefined) {
      skipped.push({ path: note.path, reason: "not in its own folder" });
      continue;
    }
    const target = join(dirname(folder), `${note.name}.md`);
    if (target !== note.path) {
      if (exists(target) || targets.has(target.toLowerCase())) {
        skipped.push({ path: note.path, reason: `target exists: ${target}` });
        continue;
      }
      targets.add(target.toLowerCase());
      steps.push({ kind: "move", from: note.path, to: target });
    }
    leaving.add(note.path);
    folders.add(folder);
  }

  for (const folder of folders) {
    const others = folderFiles(folder).filter((path) => !leaving.has(path));
    if (others.length === 0) steps.push({ kind: "deleteFolderIfEmpty", to: folder });
    else kept.push(folder);
  }
  return { steps, kept, skipped };
}

// ---------- Folder Notes plugin ----------

type FolderNotesMapping =
  | { ok: true; settings: Pick<LayoutSettings, "noteName" | "location"> }
  | { ok: false; reason: string };

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

/** Reads the Folder Notes plugin's settings object defensively; unsupported or odd values give a reason. */
export function fromFolderNotes(raw: unknown): FolderNotesMapping {
  if (!isRecord(raw)) return { ok: false, reason: "Folder Notes settings are not readable" };

  // Older versions have no folderNoteType, they only knew .md.
  const type = raw.folderNoteType;
  if (type !== undefined && type !== ".md") {
    return { ok: false, reason: `Folder note type ${typeof type === "string" ? type : "(unknown)"} is not supported, only .md` };
  }

  const name = raw.folderNoteName;
  if (typeof name !== "string" || name.trim() === "") {
    return { ok: false, reason: "Folder Notes has no usable folder note name" };
  }
  const noteName = name.trim().split("{{folder_name}}").join(NAME_TOKEN);

  let location: LayoutSettings["location"];
  switch (raw.storageLocation) {
    case "insideFolder":
      location = "inside";
      break;
    case "parentFolder":
      location = "next";
      break;
    case "vaultFolder":
      return { ok: false, reason: "Storing folder notes in the vault folder is not supported" };
    default:
      return { ok: false, reason: "Folder Notes has no usable storage location" };
  }

  const problem = validateLayout({ layout: "folder", noteName, location });
  if (problem) return { ok: false, reason: problem };
  return { ok: true, settings: { noteName, location } };
}

/** True when Folder Notes is configured differently from us (or in a way we cannot express). */
export function differsFromFolderNotes(raw: unknown, s: LayoutSettings): boolean {
  if (!isRecord(raw)) return false;
  const mapped = fromFolderNotes(raw);
  if (!mapped.ok) return true;
  return mapped.settings.noteName !== s.noteName.trim() || mapped.settings.location !== s.location;
}
