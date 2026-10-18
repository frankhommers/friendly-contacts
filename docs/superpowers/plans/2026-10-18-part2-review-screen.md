# Part 2: Sync with a Review Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync per contact first shows what differs between Radicale and Obsidian, lets the user decide per property,
and writes nothing before Apply.

**Architecture:**
- Today `syncContact(note, deps)` (src/sync/syncContact.ts) reads, merges and writes in one go, with a conflict
  callout and "no base: server wins". It is split in two phases:
  - **prepare** reads the note (L), the base (B) and the server card (S) and returns either "up to date" or a
    `SyncReview` (rows with preselection);
  - **apply** takes the review plus the user's choices, checks nothing moved, writes the card, then the note, then the
    base.
- The review model (rows, preselection, building the result R, "can apply") is pure: `src/sync/review.ts`.
- The modal (`src/ui/modals/syncReviewModal.tsx`) only renders a `SyncReview` and returns choices.
- `src/sync/sync.ts` orchestrates: source plan (Part 1) → prepare → Notice or modal → apply → reopen on stale data.
- Moving between sources becomes a line in the review screen; the Part 1 ConfirmModal flow (`moveNote`) goes away.

**Tech Stack:** TypeScript, Obsidian API (`Modal`, `fileManager.renameFile`), React 18, vitest, Radicale e2e.

**Spec:** `docs/superpowers/specs/2026-10-18-sources-review-folders-design.md`, Part 2 (and Part 1 "Changing a note's
source", "Import").

## Global Constraints

- Commits: never add `Co-Authored-By` or mention any LLM/agent.
- HTTP only through `PlatformHttpClient`; never `fetch`.
- Business logic outside `.tsx`; `src/sync/review.ts`, `src/sync/syncContact.ts` and `src/contacts/friendly/*` import
  nothing from `obsidian` or `src/context/*`.
- Test: `npm run test:run`. Build: `npm run build`. e2e: `npm run test:e2e`. All pass at the end of every task.
- Nothing is written to the note, the server or the sync state before Apply. Cancel writes nothing, not even a base.
- Unchanged vCard lines stay byte-identical (the existing `patch` guarantees this; keep using it).
- A card is never written to a source other than the one decided, and never duplicated (Part 1 rules stay).
- Photos are never shown as base64 text; relationship values are shown as names, never as UIDs.
- Exact texts from the spec: Notice `Up to date`; title `New card in <source>`; line `Address book: <from> -> <to>`;
  checkbox `Rename note to <new name>`; buttons `All from Radicale`, `All from Obsidian`, `Apply`, `Cancel`;
  section `Also changes`; Notice on 412 `changed on the server meanwhile` (prefixed with the contact name).

## Rulings made while planning

- Ruling: the conflict callout code (`renderConflictCallout`, `NoteIO.appendToBody`) is deleted; existing callouts in
  notes are left alone (spec) — cost if wrong: none.
- Ruling: "Show all" is a toggle in the modal header, off by default; unchanged rows appear greyed and read-only
  (spec builder's call) — cost if wrong: cosmetic.
- Ruling: for a new card (no card in any source) every row is preselected Obsidian and there are no conflicts, so
  Apply is enabled at once — spec says "every row comes from Obsidian" — cost if wrong: one extra click.
- Ruling: a source move without property differences still opens the screen (only the move line), so the move is
  always confirmed — spec "No differences … no source change" — cost if wrong: none.
- Ruling: "Sync this contact" appears as a command and in the existing sidebar menu; not in the file menu (spec
  leaves it to the builder) — cost if wrong: one more menu entry later.

## Review Focus

1. **Note edited while the screen is open** (user types in the note, or Obsidian Sync brings a change) → Apply
   aborts with a Notice and reopens with fresh data; nothing written. Test: Task 2 `apply aborts when the note changed`.
2. **Card changed on the server while the screen is open** → PUT gets 412 → nothing written to the note, Notice,
   screen reopens with fresh data. Test: Task 2 `apply reopens on 412 and writes nothing`.
3. **A list property where both sides added different items** (`children` [A, B] vs [A, C], base [A]) → conflict row,
   whole list chosen; the result is exactly the chosen side's list, mirroring then follows. Test: Task 1
   `list conflict is chosen as a whole`.
4. **Custom edit that equals one side** → treated as that value, no spurious change; empty custom text → property
   removed. Test: Task 1 `custom text equal to a side is that side`, `empty custom text removes`.
5. **First Sync without a base where note and card already agree** → `Up to date`, base stored, nothing else
   written; where they differ → every differing row is a conflict (no silent server win). Test: Task 2
   `no base and equal stores the base only`, `no base and different makes conflicts`.

---

### Task 1: Review model

**Files:**
- Create: `src/sync/review.ts`
- Test: `tests/review.spec.ts`

**Interfaces:**
- Consumes: `sameValue`, `coerceNoteProps`, `alignNoteDates` (`src/contacts/friendly/merge.ts`), `MappingRow`,
  `rowForProperty`, `FriendlyValue`.
- Produces:
  ```ts
  export type Side = 'server' | 'local';
  export type Choice = Side | { custom: string };
  export interface ReviewRow {
    property: string;
    server: FriendlyValue | undefined;
    local: FriendlyValue | undefined;
    preselect: Side | undefined;     // undefined = conflict, must be decided
    kind: 'text' | 'list' | 'photo' | 'relation';
    changed: boolean;                // false only for "Show all" rows
  }
  export function reviewRows(base: Props | undefined, server: Props, local: Props, rows: MappingRow[], opts: { newCard: boolean }): ReviewRow[];
  export function isUpToDate(rows: ReviewRow[]): boolean;           // no row with changed === true
  export function canApply(rows: ReviewRow[], choices: Map<string, Choice>): boolean;
  export function resultProps(rows: ReviewRow[], choices: Map<string, Choice>, server: Props): Props; // R
  ```
  - `reviewRows`: one row per property in L ∪ F(S) ∪ B where `!sameValue(server, local, property)` (changed) plus,
    for "Show all", every other mapped property with `changed: false`, sorted in mapping order.
    Preselection: base present and `sameValue(base, local)` → `server`; base present and `sameValue(base, server)` →
    `local`; otherwise (both changed, or no base) → undefined. `newCard` → every row `local`.
  - `kind`: relation rows → `relation`; `format: 'list'` → `list`; `photo`/`photo-N` → `photo`; else `text`.
  - `resultProps`: start from `server` (F(S)); for each changed row apply the choice (`server` keeps, `local` takes the
    note's value or removes when undefined, `custom` takes the trimmed text or removes when empty; custom is only
    offered for `text` rows — a custom choice on another kind throws).
  - `canApply`: every row with `preselect === undefined && changed` has a choice.
- [ ] **Step 1: Write the failing tests**: `only differing rows`; `server-only change preselects Radicale`;
  `note-only change preselects Obsidian`; `both changed is a conflict`; `no base makes every difference a conflict`;
  `new card preselects Obsidian everywhere`; `list conflict is chosen as a whole`; `custom text equal to a side is
  that side`; `empty custom text removes`; `cannot apply with an undecided conflict`; `show-all rows are unchanged
  and ignored by resultProps`; `photo data uri equals bare base64` (no row).
- [ ] **Step 2: Run** `npm run test:run -- tests/review.spec.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** full suite + build → PASS.
- [ ] **Step 5: Commit** `feat(sync): review model for the sync screen`

### Task 2: Prepare and apply

**Files:**
- Modify: `src/sync/syncContact.ts` (replace `syncContact`/`syncOnce`/`createCard`/`writeNote` by prepare/apply;
  delete the callout path), `src/contacts/friendly/merge.ts` (delete `renderConflictCallout`, `Conflict` if unused),
  `src/contacts/obsidianNotes.ts` (`NoteIO.appendToBody` removed)
- Test: `tests/syncContact.spec.ts` (rewritten around prepare/apply; keep every still-valid scenario: Apple href not
  `<uid>.vcf`, `urn:uuid:` spelling, unrepresentable `street-2`, untouched lines byte-identical, no ETag → refuse,
  `source` never on the card, legacy `1604` dates)

**Interfaces:**
- Consumes: Task 1; `patch`, `newCard`, `toFriendly`, `parseCard`, `serializeCard`; `moveCard` (Part 1).
- Produces:
  ```ts
  export interface PreparedSync {
    uid: string;
    local: Props;                      // L as read (coerced, canonical relations, aligned dates)
    noteSnapshot: string;              // JSON of mapped props + source as read, for the staleness check
    server?: { lines: VCardLine[]; friendly: Friendly; href: string; etag: string; raw: string };
    base?: Props;
    rows: ReviewRow[];
    target: { sourceId: string };      // where the card will live
    move?: { from: CardLocation };     // card currently in another source (Part 1 'move')
  }
  export type PrepareResult = { kind: 'upToDate' } | { kind: 'review'; prepared: PreparedSync } | { kind: 'failed'; message: string };
  export function prepareSync(note: NoteIO, deps: SyncDeps, where: { sourceId: string; move?: { from: CardLocation; adapter: AdapterInterface; state: SyncState } }): Promise<PrepareResult>;
  export type ApplyResult = { kind: 'done'; outcome: SyncOutcome } | { kind: 'stale'; reason: 'note' | 'server' } | { kind: 'failed'; message: string };
  export function applySync(prepared: PreparedSync, R: Props, note: NoteIO, deps: SyncDeps, opts: { rename?: string; sourceName: string }): Promise<ApplyResult>;
  ```
  - `prepareSync`: a note without `uid` gets no UID written yet (the UID is generated in memory and written at Apply).
    When the card is in `where.move.from`, S is read from that source. `upToDate` when `isUpToDate(rows)` and no move;
    then, if there is no base, store S as base (the only write before Apply, as the spec says) and return.
  - `applySync` order (spec "Apply"): re-read the note → if `noteSnapshot` differs → `stale: note`; card:
    `patch(S, F(S), R)` (or `newCard(R)` without S); if it differs from S → PUT with `If-Match` (`ifNoneMatch` for a
    new card; for a move: `moveCard` with the patched raw) — 412 → `stale: server`, no ETag → `failed`; note: write
    changed mapped properties, `uid` if new, `source: <sourceName>`; rename via `NoteIO.rename(newBasename)` when
    `opts.rename` is set (new NoteIO member; skipped with a warning when the target exists); store the base under
    the target source.
  - `SyncDeps.notify` stays for warnings; `now` can go if unused.
- [ ] **Step 1: Rewrite the tests** (fake adapter/state/note as today): the five Review Focus cases plus the kept
  scenarios above, `move writes the reviewed card to the new book and deletes the old`, `cancel path writes nothing`
  (prepare only → no writes except the up-to-date base case).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** full suite + build + e2e (adapt `tests/e2e/radicale.e2e.ts` to prepare/apply with explicit
  choices) → PASS.
- [ ] **Step 5: Commit** `feat(sync): prepare and apply a reviewed sync`

### Task 3: Review screen

**Files:**
- Create: `src/ui/modals/syncReviewModal.tsx`, `src/sync/reviewDisplay.ts`
- Modify: `styles.css`
- Test: `tests/reviewDisplay.spec.ts`

**Interfaces:**
- Consumes: Task 1 (`ReviewRow`, `Choice`, `canApply`), Task 2 (`PreparedSync`).
- Produces:
  - `reviewDisplay.ts` (pure): `displayValue(row: ReviewRow, side: Side, linkName: (link: string) => string): { text?: string; image?: string; items?: { name: string; only: boolean }[] }`
    — text as is; photo → `image` (data URI or URL; bare base64 → `data:image/jpeg;base64,`); list/relation →
    items with `only: true` for items present on this side only; relation items use `linkName` (alias or link
    target, never a UID); absent → text `(none)`.
  - `SyncReviewModal(app, input: { title: string; moveLine?: string; prepared: PreparedSync; also: string[]; rename?: { to: string; blocked?: string }; serverOnly: (row) => { name: string; import(): Promise<void> }[] }, onApply: (choices, rename: boolean) => void)`:
    table Property | Radicale | Obsidian | Result; each changed row has two radio-like buttons (Radicale /
    Obsidian) and, for text rows, an edit field that sets a custom choice; conflict rows marked until decided;
    `All from Radicale` / `All from Obsidian`; `Show all` toggle; `Also changes` list; rename checkbox (checked by
    default, disabled with the reason when blocked); `Apply` disabled until `canApply`; `Cancel` closes. Server-only
    relation targets show an `Import` button that runs the import and then closes the modal with a "reopen" signal.
- [ ] **Step 1: Write the failing tests** for `displayValue`: `photo shows as image`, `bare base64 photo becomes a
  data uri`, `relation items show names and one-side markers`, `absent shows (none)`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** the helpers and the modal. **Step 4: Run** full suite + build →
  PASS.
- [ ] **Step 5: Commit** `feat(sync): review screen`

### Task 4: Orchestration, Sync this contact, Also changes, rename

**Files:**
- Modify: `src/sync/sync.ts` (`runSync`; remove `confirmMove`, `moveNote`, `syncWith`'s one-shot sync),
  `src/main.ts` (command), `src/ui/sidebar/components/ContactView.tsx` (menu entry label stays "Sync")
- Create: `src/sync/reviewExtras.ts`
- Test: `tests/reviewExtras.spec.ts`

**Interfaces:**
- Consumes: Tasks 1–3; Part 1 `noteSourceId`, `planSync`, `locateCard`, `importRemoteCard`; `planMirrorWrites`,
  `relationSnapshot`; `contactFileName` (via `newCard` lines of the props).
- Produces (`reviewExtras.ts`, pure):
  - `alsoChanges(path: string, before: Props, after: Props, rows, resolve, nameOf): string[]` — mirror writes the
    result would trigger, as `"<other name>: <property> gets <link>"` / `"… loses …"` (via `planMirrorWrites`).
  - `renameTarget(before: Props, after: Props, rows): string | undefined` — the computed file name of R when it
    differs from the computed file name of L (spec builder's call: compare computed names, never the actual file
    name; a hand-renamed note is left alone unless its values change).
- `runSync`: plan as in Part 1 → `prepareSync` → `upToDate`: Notice `Up to date` → else open the modal with
  title `<name>` (or `New card in <source>`), move line `Address book: <from> -> <to>` for moves; on Apply call
  `applySync`; `stale` → Notice (`<name> changed on the server meanwhile` or `<name> changed while reviewing`) and
  reopen with fresh data (at most 3 times, then stop with a Notice); Import from the modal → reopen. After Apply,
  `ctx.settle()` as today.
- Command `friendly-contacts-sync-contact` "Sync this contact" for the active contact note.
- [ ] **Step 1: Write the failing tests**: `also changes lists the mirror writes`; `rename only when the computed name
  changes`; `hand-renamed note is not renamed when names are unchanged`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** full suite + build + e2e → PASS.
- [ ] **Step 5: Commit** `feat(sync): sync each contact through the review screen`

### Task 5: Checklist and README

**Files:**
- Modify: `tests/scripts/radicale-e2e.md`, `README.md`

- [ ] **Step 1:** Checklist: Sync with no differences (Up to date), a server-only change (preselected Radicale), a
  conflict (Apply disabled until decided), Cancel (nothing changes), a custom edit, a photo difference (thumbnails),
  a relationship difference with a server-only person (Import button), a rename checkbox, a move between books, a
  412 (change the card on the phone while the screen is open). README: short section "Syncing a contact" describing
  the screen.
- [ ] **Step 2: Run** `npm run test:run`, `npm run build` → PASS.
- [ ] **Step 3: Commit** `docs: sync review screen`
