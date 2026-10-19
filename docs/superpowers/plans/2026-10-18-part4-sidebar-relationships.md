# Part 4: Relationships in the Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The sidebar's contact view shows a contact's relationships as names and lets the user add and remove them
without typing links.

**Architecture:** Relationship edits are functions over the existing `MirrorEnv` (`src/contacts/relationMirror.ts`), so
they are unit-tested with the fake env the mirror tests already use and write through `processFrontMatter` in the app.
The existing mirroring adds or removes the other side. The UI is a React section in `ContactView` plus a two-step
picker modal and a command.

**Tech Stack:** TypeScript, Obsidian API, React 18, vitest.

**Spec:** `docs/superpowers/specs/2026-10-18-sources-review-folders-design.md`, Part 4.

## Global Constraints

- Commits: never add `Co-Authored-By` or mention any LLM/agent.
- Business logic outside `.tsx`; UI only calls core modules.
- Links are produced by Obsidian (`MirrorEnv.linkTo` → `fileToLinktext`), always `[[...]]` in properties.
- Relation kinds come from the mapping table (`row.kind === 'relation'`), never from a hard-coded list of names.
- Nothing reaches Radicale until that contact is synced.
- Test: `npm run test:run`. Build: `npm run build`. Both pass at the end of every task.

## Review Focus

1. **Adding a second spouse** (`spouse` is a single relation) → ConfirmModal `Replace <old> with <new> as spouse?`;
   never a list. Test: Task 1 `single relation is replaced, not appended`.
2. **Adding a relationship that already exists under another link text** (`[[People/Sem]]` vs `[[Sem]]`) → no-op,
   because links are compared by the note they resolve to. Test: Task 1 `existing link by another text is a no-op`.
3. **Removing a name whose link does not resolve** (ghost) → removed by its text. Test: Task 1 `removes an unresolved
   entry by text`.
4. **The contact links to itself** → the picker never offers the contact itself. Test: Task 2 `picker excludes self`.
5. **Relation property holding a single string instead of a list** (hand-edited) → shown and edited correctly; adding
   to it makes a list. Test: Task 1 `adds to a property holding one string`.

---

### Task 0: Folder follow-ups from the Part 3 final review

**Files:**
- Modify: `src/contacts/layoutNotes.ts`, `src/contacts/obsidianNotes.ts` (`moveContacts`), `src/sync/syncContact.ts` or
  `src/contacts/layoutNotes.ts` (alias after a server-side rename), `README.md`, `tests/scripts/radicale-e2e.md`
- Test: `tests/layoutNotes.spec.ts`, `tests/relationLinks.spec.ts`

Context: `.superpowers/sdd/2026-10-19-part3-folder-per-contact/progress.md` (final review lines) and
`final-fix-report.md` in the same directory.

- Gap A: in one-note layout, "Move contacts to folder…" must move contacts that still sit in folders (made with any
  settings, recognised by `isNamedForContact` / `contactFolderOf`) as whole folders — use `moveContactFolders` for every
  layout. Test `one-note move keeps a leftover folder with its poem`.
- Gap B: a Sync rename of a contact whose folder was made with other settings renames the folder too (let the contact
  folder lookup accept a folder named for the contact, with the existing `folderMoveProblem` guard). Test `rename of an
  other-settings contact renames its folder`.
- Item 7: after a server-side name change, the rewritten aliases use the NEW name (pass the new display name into the
  rewrite instead of reading the cached `name`). Test `server rename refreshes aliases`. Fix README's claim if needed.
- Take-out double rename: run the same relationship-link rewrite pass after take-out that "into" uses, so no entry
  is left pointing at the temporary name. Test with the fake vault; add "relationships still open the contact after
  take-out" to the checklist.
- One-note layout with leftover fixed-name folders: `contactLinktext` writes full path + alias whenever the target's
  note basename differs from the contact's name (not only in a fixed-name layout). Test.
- [ ] TDD each; full suite + build + e2e; commit `fix(layout): keep leftover contact folders together`.

### Task 1: Relationship edits and the display model

**Files:**
- Create: `src/contacts/relationEdit.ts`
- Test: `tests/relationEdit.spec.ts` (reuse the fake `MirrorEnv` from `tests/relationMirror.spec.ts`; move it to
  `tests/fakes/mirrorEnv.ts` if it is local to that spec)

**Interfaces:**
- Produces:
  ```ts
  export interface RelationPerson { text: string; display: string; path?: string } // text = the stored value
  export interface RelationGroup { property: string; type: string; people: RelationPerson[] }
  export function relationGroups(env: MirrorEnv, rows: MappingRow[], path: string, frontmatter: Record<string, unknown>, nameOf: (path: string) => string): RelationGroup[];
  export type AddResult = 'added' | 'exists' | { replaces: string };
  export function planAdd(env: MirrorEnv, rows: MappingRow[], path: string, frontmatter: Record<string, unknown>, property: string, targetPath: string): AddResult;
  export function addRelation(env: MirrorEnv, rows: MappingRow[], path: string, property: string, targetPath: string): Promise<void>;
  export function removeRelationEntry(env: MirrorEnv, rows: MappingRow[], path: string, property: string, text: string): Promise<void>;
  ```
  - `relationGroups`: one group per relation row (in mapping order) that has entries; `type` = `row.types[0]`;
    `display` = `nameOf(path)` for resolved entries, else the alias (`[[x|Alias]]`) or the link target text.
  - `planAdd`: `'exists'` when an entry already resolves to `targetPath`; for a single row with another value,
    `{ replaces: <display of the old value> }`; else `'added'`.
  - `addRelation`: writes `env.linkTo(targetPath, path)` via `env.updateProperty`; lists stay lists, a single string
    becomes a list for list rows, single rows are set (replacing).
  - `removeRelationEntry`: removes the entry whose stored text equals `text` (or that resolves to the same note);
    an emptied list removes the property.
- [ ] **Step 1: Write the failing tests**: `groups in mapping order with names`; `unresolved entry shows its alias or
  text`; `existing link by another text is a no-op`; `single relation is replaced, not appended`; `adds to a property
  holding one string`; `removes an unresolved entry by text`; `emptied list removes the property`.
- [ ] **Step 2: Run** `npm run test:run -- tests/relationEdit.spec.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run test:run`, `npm run build` → PASS.
- [ ] **Step 5: Commit** `feat(relations): add and remove relationships by contact`

### Task 2: Relationships section, picker and command

**Files:**
- Create: `src/ui/sidebar/components/RelationshipsSection.tsx`, `src/ui/modals/addRelationshipModal.ts`
- Modify: `src/ui/sidebar/components/ContactView.tsx`, `src/main.ts`, `styles.css`
- Test: `tests/addRelationship.spec.ts` (pure helpers only)

**Interfaces:**
- Consumes: Task 1; `obsidianMirrorEnv(app)`, `contactNotes(app)`; Part 1's `remoteContacts()` / import-one-contact
  function for the Import button.
- Produces:
  - `pickableContacts(notes: { path: string; name: string }[], selfPath: string): { path: string; name: string }[]` (pure,
    exported from `addRelationshipModal.ts`): every contact note except `selfPath`, sorted by name.
  - `AddRelationshipModal(app, contactPath)`: step 1 `FuzzySuggestModal` of `pickableContacts`; step 2
    `SuggestModal` of the relation rows (`<property> (<type>)`); then `planAdd` → `exists`: Notice `<name> is already
    listed under <property>.`; `replaces`: ConfirmModal; `added`: `addRelation`.
  - `RelationshipsSection({ file })`: heading "Relationships" and a "+ Relationship" button (opens the modal), then one
    line per group: label = property, names as links (click opens the note), unresolved names greyed; a name whose
    text resolves to exactly one remote UID (`resolveRemoteName` on `remoteContacts()`) has an **Import** button; each
    name has a × that asks `Remove <name> from <property>?` then calls `removeRelationEntry`. Re-renders on
    `metadataCache` changes of this file (existing sidebar refresh is enough if it already re-renders on change; check
    and use it).
  - Command `friendly-contacts-add-relationship` "Add relationship…" for the active contact note (Notice when the
    active file is not a contact).
- [ ] **Step 1: Write the failing test** `picker excludes self` and `picker sorts by name`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** full suite + build → PASS.
- [ ] **Step 5: Commit** `feat(sidebar): show and edit relationships`
