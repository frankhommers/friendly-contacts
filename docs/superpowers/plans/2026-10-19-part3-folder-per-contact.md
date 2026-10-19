# Part 3: Folder per Contact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An optional layout where every contact gets its own folder with the contact note as folder note, so poems,
speeches and photos can live next to the person; configurable for anyone, with or without the Folder Notes plugin.

**Architecture:**
- Pure layout logic in `src/contacts/layout.ts` (no `obsidian` imports): paths per layout, which folder belongs to a
  contact note, rename/move/convert plans, Folder Notes settings mapping.
- Obsidian-facing executors in `src/contacts/layoutNotes.ts` run those plans through `app.fileManager.renameFile`,
  `vault.createFolder` and (only for empty folders) `vault.delete`.
- Existing entry points (import, sidebar create, review-screen rename, Move contacts) go through the layout.

**Tech Stack:** TypeScript, Obsidian API, React 18 settings UI, vitest.

**Spec:** `docs/superpowers/specs/2026-10-18-sources-review-folders-design.md`, Part 3.

## Global Constraints

- Commits: never add `Co-Authored-By` or mention any LLM/agent.
- Business logic outside `.tsx`; `src/contacts/layout.ts` imports nothing from `obsidian` or `src/context/*`.
- Test: `npm run test:run`. Build: `npm run build`. e2e: `npm run test:e2e`. All pass at the end of every task.
- Other files in a contact's folder are never read as contacts, synced, mirrored, renamed away from their person or
  deleted. A folder is deleted only when it is empty.
- All renames and moves go through `app.fileManager.renameFile` (links update). Existing targets are skipped and
  reported, never overwritten.
- Settings values from the spec: layout `note` (default) | `folder`; folder note name pattern default `{{name}}`;
  location `inside` (default) | `next`; "next to" with a fixed name is refused.
- Folder Notes mapping: `folderNoteName` with `{{folder_name}}` → `{{name}}`; `storageLocation` `insideFolder` →
  `inside`, `parentFolder` → `next`, `vaultFolder` → not supported; `folderNoteType` other than `.md` → not supported.
  Read once, defensively; never at runtime.

## Rulings made while planning

- Ruling: in folder layout a new contact is created in the contacts folder, or in the active note's folder when that
  folder is inside the contacts folder and is not itself a contact's folder (then its parent) — today's "create next to
  the active note" behaviour would otherwise put a new person inside someone else's folder — cost if wrong: one
  manual move.
- Ruling: a note counts as "in its folder" only when the derived folder matches (inside: parent folder named like the
  contact with note name = pattern; next: sibling folder named like the note's basename exists) — everything else is
  treated as one-note layout by the commands — cost if wrong: a note the commands skip.
- Ruling: relationship links to a contact whose note has a fixed name get the contact name as alias
  (`[[Contacts/Jan de Vries/index|Jan de Vries]]`), produced in both `ObsidianRelationContext.uidToName` and
  `MirrorEnv.linkTo` — spec "Links" — cost if wrong: cosmetic.

## Review Focus

1. **A contact folder holding poems is converted back to one-note layout** → only the note moves out; the folder and
   the poems stay; the result lists the folder. Test: Task 4 `take out keeps folders with other files`.
2. **Folder Notes renamed the folder already (`syncFolderName`) when we rename** → our rename sees the folder at its
   target and only renames the note (or nothing). Test: Task 1 `rename is idempotent after an outside folder rename`.
3. **Two contacts would get the same folder** (same computed name) → the second is skipped and reported, never merged
   into the first's folder. Test: Task 1 `same target folder is skipped`.
4. **Fixed note name `index` and a relationship to someone imported later** → the unresolved `[[Sem de Vries]]` in
   Jan's note is rewritten to Sem's new note link after import; mirroring then adds Jan to Sem. Test: Task 5
   `import relinks unresolved relationships`.
5. **Folder Notes settings with odd values** (missing keys, `vaultFolder`, `.canvas`) → Notice, nothing changes.
   Test: Task 1 `folder notes mapping refuses unsupported settings`.

---

### Task 1: Layout model

**Files:**
- Create: `src/contacts/layout.ts`
- Test: `tests/layout.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface LayoutSettings { layout: 'note' | 'folder'; noteName: string; location: 'inside' | 'next' }
  export const DEFAULT_LAYOUT: LayoutSettings; // { layout: 'note', noteName: '{{name}}', location: 'inside' }
  export function validateLayout(s: LayoutSettings): string | undefined;      // empty/invalid pattern, next + fixed name
  export function noteBasename(name: string, s: LayoutSettings): string;       // pattern with {{name}} replaced
  export function contactPaths(baseFolder: string, name: string, s: LayoutSettings): { folder?: string; note: string };
  export function contactFolderOf(notePath: string, s: LayoutSettings, folderExists: (p: string) => boolean): string | undefined;
  export interface FsStep { kind: 'createFolder' | 'move' | 'deleteFolderIfEmpty'; from?: string; to: string }
  export function planRename(notePath: string, newName: string, s: LayoutSettings, exists: (p: string) => boolean): { steps: FsStep[]; skipped?: string };
  export function planIntoFolders(notes: { path: string; name: string }[], s: LayoutSettings, exists: (p: string) => boolean): { steps: FsStep[]; skipped: { path: string; reason: string }[] };
  export function planOutOfFolders(notes: { path: string; name: string }[], s: LayoutSettings, exists: (p: string) => boolean, folderFiles: (folder: string) => string[]): { steps: FsStep[]; kept: string[]; skipped: { path: string; reason: string }[] };
  export function fromFolderNotes(raw: unknown): { ok: true; settings: Pick<LayoutSettings, 'noteName' | 'location'> } | { ok: false; reason: string };
  export function differsFromFolderNotes(raw: unknown, s: LayoutSettings): boolean;
  ```
  - `planRename` in folder layout: move the folder first if it is not yet at its target, then the note (path inside
    the new folder) if it is not at its target; with a fixed note name only the folder moves; one-note layout: the
    note only. A target that exists (and is not the thing itself) → `skipped` with the path, no steps.
  - `planOutOfFolders`: move the note out next to its folder (`<parent>/<name>.md`), then `deleteFolderIfEmpty`;
    folders with other files go to `kept`.
- [ ] **Step 1: Write the failing tests**: paths for inside/next/fixed; `next with a fixed name is refused`;
  `contactFolderOf` for each layout and for a note that is not in its folder; `rename moves folder then note`;
  `rename with a fixed note name moves the folder only`; `rename is idempotent after an outside folder rename`;
  `rename target exists is skipped`; `into folders`; `same target folder is skipped`; `out of folders deletes empty
  folders only`; `take out keeps folders with other files` (here as plan: `kept`); `folder notes mapping`
  (`{{folder_name}}`, insideFolder, parentFolder); `folder notes mapping refuses unsupported settings` (vaultFolder,
  `.canvas`, missing/odd values); `differs from folder notes`.
- [ ] **Step 2: Run** `npm run test:run -- tests/layout.spec.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** full suite + build → PASS.
- [ ] **Step 5: Commit** `feat(layout): model for a folder per contact`

### Task 2: Layout settings

**Files:**
- Modify: `src/settings/settings.d.ts`, `src/settings/setting.ts`, `src/context/sharedSettingsContext.ts`
  (`layout: LayoutSettings`, default `DEFAULT_LAYOUT`), `src/ui/settings/settingsView.tsx`
- Create: `src/ui/settings/components/layoutSettings.tsx`, `src/contacts/folderNotesPlugin.ts`

**Interfaces:**
- Produces: `folderNotesSettings(app: App): unknown | undefined` (enabled plugin `folder-notes` → its `settings`
  object, else undefined; never throws).
- UI section "Contact layout": layout dropdown (`One note per contact` / `Folder per contact`), folder note name
  text field (validated with `validateLayout`), location dropdown (`Inside the folder` / `Next to the folder`); a
  `Copy from Folder Notes` button only when Folder Notes is enabled (uses `fromFolderNotes`; failure → Notice with the
  reason); a warning line `Folder Notes uses different settings.` when `differsFromFolderNotes` (computed when the
  section mounts); a hint under a fixed name: `Obsidian's graph and tabs will show every contact as "<name>".`
  Switching the layout offers the matching command (Task 4) via ConfirmModal (`Put <n> contacts in their own folder?`
  / `Take <n> contacts out of their folders?`).
- [ ] **Step 1:** tests for settings defaults/migration in `tests/context.spec.ts` (`layout defaults to one note per
  contact`).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** full suite + build → PASS.
- [ ] **Step 5: Commit** `feat(layout): contact layout settings`

### Task 3: New contacts and renames follow the layout

**Files:**
- Create: `src/contacts/layoutNotes.ts`
- Modify: `src/contacts/obsidianNotes.ts` (`importCard`, `noteIO().rename`), `src/ui/sidebar/components/SidebarRootView.tsx`
  (create), `src/file/file.ts` (`createContactFile` gains the layout-aware path), `src/sync/syncFlow.ts` /
  `src/ui/modals/syncReviewModal.tsx` (label `Rename folder and note to <name>` in folder layout)
- Test: `tests/layoutNotes.spec.ts` (fake app as in existing specs)

**Interfaces:**
- Produces:
  - `newContactLocation(app: App, name: string): { folder?: string; note: string }` — per the planning ruling.
  - `runSteps(app: App, steps: FsStep[]): Promise<{ done: number; failed: { step: FsStep; reason: string }[] }>`.
  - `renameContact(app: App, file: TFile, newName: string): Promise<'renamed' | 'exists'>` used by `NoteIO.rename`.
- Folder clash: an existing folder with that name and no contact note in it is used; with a contact note in it, the
  existing Replace/Skip dialog decides for the note path (as today).
- [ ] **Step 1: Write the failing tests**: `new contact in folder layout gets folder and note`; `not inside another
  contact's folder`; `existing empty folder is reused`; `rename in folder layout renames folder and note`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** full suite + build + e2e → PASS.
- [ ] **Step 5: Commit** `feat(layout): create and rename contacts in their folders`

### Task 4: Layout commands and moving whole folders

**Files:**
- Modify: `src/contacts/layoutNotes.ts`, `src/main.ts`, `src/contacts/obsidianNotes.ts` (`moveContacts`),
  `src/contacts/moveContacts.ts`
- Test: `tests/layoutNotes.spec.ts`, `tests/moveContacts.spec.ts`

**Interfaces:**
- Commands `friendly-contacts-into-folders` "Put each contact in its own folder" and `friendly-contacts-out-of-folders`
  "Take contacts out of their folders"; each reports `Moved <n>, skipped <m>, kept <k> folders with other files (see
  console)`.
- `Move contacts to folder…` in folder layout plans moves of contact folders (whole folders, relative paths kept);
  in one-note layout it is unchanged.
- [ ] **Step 1: Write the failing tests**: `take out keeps folders with other files` (executor: folder and files stay);
  `into folders skips notes already in their folder`; `move contacts moves whole folders in folder layout`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** full suite + build → PASS.
- [ ] **Step 5: Commit** `feat(layout): commands to switch layout and move whole folders`

### Task 5: Links with a fixed note name

**Files:**
- Modify: `src/contacts/obsidianNotes.ts` (`ObsidianRelationContext.uidToName`, `obsidianMirrorEnv().linkTo`,
  `importRemoteCard`), `src/contacts/friendly/relations.ts` if a helper is needed
- Test: `tests/relationLinks.spec.ts`

**Interfaces:**
- Produces: `linkWithAlias(linktext: string, displayName: string): string` (pure, in relations.ts): returns
  `linktext` when its last path segment equals `displayName`, else `linktext|displayName`.
  `relinkAfterImport(app: App, uid: string, file: TFile): Promise<number>` — in contact notes, relationship entries
  that do not resolve to a note and whose remote-name resolution gives `uid` are replaced by the new note's link;
  returns the count. Called after an import in a fixed-name layout.
- [ ] **Step 1: Write the failing tests**: `alias when the note name differs`; `no alias when equal`; `import relinks
  unresolved relationships`; `relink leaves other links alone`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** full suite + build + e2e → PASS.
- [ ] **Step 5: Commit** `feat(layout): readable links to contacts with a fixed note name`

### Task 6: Checklist and README

- [ ] Checklist items in `tests/scripts/radicale-e2e.md`: switch to folder layout and run the command; put a poem in a
  folder, sync, rename via the review screen (folder and note move, poem stays); Copy from Folder Notes; take contacts
  out (folder with poem kept); Move contacts to folder… in folder layout. README section "A folder per contact".
- [ ] Run `npm run test:run`, `npm run build`. Commit `docs: folder per contact`.
