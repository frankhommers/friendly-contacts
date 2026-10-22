# Every part of a field visible, and "Write as" per vCard version — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every standard part of `N`, `ORG`, `ADR` and `GENDER` gets a default row; the property names table shows a Part column and a vCard 3.0 write column; a generic per-row 3.0 write key; no data loss for values that were already on cards.

**Architecture:** Mapping rows get optional `writeV3` and `sinceReader`; one helper picks the write key by card version. New default rows are added once by a migration tracked in settings (`friendly.defaultRowsSeen`). Sync bases stored with reader < 3 are read without rows marked `sinceReader: 3`, so newly visible values arrive as server additions.

**Tech Stack:** TypeScript, React (settings), vitest (+ jsdom for UI), Radicale e2e (`npm run test:e2e`).

**Spec:** `docs/superpowers/specs/2026-10-22-parts-and-write-per-version-design.md`

## Global Constraints

- No code path for a particular field (gender, department, prefix): if a task needs such an `if`, stop and report.
- Existing lines keep their field name on edit; write keys only name new lines. `VERSION` never changes.
- Untouched card lines stay byte-identical.
- The table shows Part as `index + 1`; storage keeps 0-based `ComponentRow.index`.
- Column headers exactly: `Name`, `Read from`, `Part`, `Write as (vCard 4.0)`, `Write as (vCard 3.0)`; 3.0 input placeholder exactly `same as 4.0`.
- Git: never add Co-Authored-By or mention any LLM/agent in commits.
- Run unit tests with `npx vitest run <file>`; full suite `npm run test:run`; type check + build `npm run build`.

## Review Focus

1. An owner who edited `street`'s write key (e.g. `ADR;TYPE=home`) before updating: new `po-box` must land on the same line, not create a second `ADR` (Task 3 test).
2. A sync base stored with reader 1 or 2 and a card with `ORG:Acme;Sales`: Sync must bring `department` into the note, never offer to remove it, and must not offer a rename for a newly visible name prefix (Task 4 tests).
3. A note that already has a hand-written `department: Marketing` while the card (reader-2 base) has `Sales`: shown as a choice, not silently overwritten either way (Task 4 test).
4. Escaped separators inside a part (`ORG:A\;B;Sales`): `company` is `A;B`, `department` is `Sales`, editing `department` keeps `A\;B` (Task 2 test).
5. Part input `0`, `abc`, `1.5`, empty on a component row: validation error, nothing saved (Task 5 test).

---

### Task 1: Mapping model, default rows, validation

**Files:**
- Modify: `src/contacts/friendly/mapping.ts`
- Test: `tests/friendly/mapping.spec.ts`

**Interfaces:**
- Produces:
  - `FieldRow.writeV3?: string`, `ComponentRow.writeV3?: string`; `FieldRow.sinceReader?: number`, `ComponentRow.sinceReader?: number`.
  - `export function writeKeyFor(row: FieldRow | ComponentRow, version: string): string` — `row.writeV3` when `version.trim() !== '4.0'` and `writeV3?.trim()` is non-empty, else `row.write`.
  - New rows in `DEFAULT_MAPPING`, in this order (component rows, 0-based index, all with `sinceReader: 3`):
    - `name-prefix` (`['N']`, `'N'`, 3) right after `name`; `name-suffix` (`['N']`, `'N'`, 4) right after `lastname`.
    - `department` (`['ORG']`, `'ORG'`, 1) right after `company`.
    - `gender` (`['GENDER', 'X-GENDER']`, `'GENDER'`, `writeV3: 'X-GENDER'`, 0) and `gender-identity` (same read/write/writeV3, 1) right after `role`.
    - `po-box` (`HOME_ADR`, `'ADR;TYPE=HOME'`, 0), `address-extra` (same, 1) right before `street`.
    - `work-po-box` (`WORK_ADR`, `'ADR;TYPE=WORK'`, 0), `work-address-extra` (same, 1) right before `work-street`.
  - `validateMapping` messages: a blank `writeV3` is fine (same as 4.0); a non-blank `writeV3` whose name (before the first `;`) is empty gives `Property "<key>" has an invalid vCard 3.0 write key.`; a component row whose `index` is not an integer ≥ 0 gives `Property "<key>" has an invalid part.`

- [ ] **Step 1: Write failing tests** in `tests/friendly/mapping.spec.ts`:
  - `writeKeyFor` returns `X-GENDER` for the default `gender` row with `'3.0'`, `GENDER` with `'4.0'` and with `' 4.0 '`; a row with `writeV3: '  '` returns `write` on `'3.0'`.
  - The default mapping's property order contains the sequence `name, name-prefix, firstname, middlename, lastname, name-suffix`; `company, department`; `role, gender, gender-identity`; `po-box, address-extra, street`; `work-po-box, work-address-extra, work-street`.
  - Every new default row has `sinceReader: 3`; no pre-existing default row has `sinceReader`.
  - `validateMapping(DEFAULT_MAPPING)` is `[]`; with `department.index = -1` and `1.5` it includes `Property "department" has an invalid part.`; with `writeV3: ';TYPE=X'` it includes `Property "gender" has an invalid vCard 3.0 write key.`
- [ ] **Step 2: Run** `npx vitest run tests/friendly/mapping.spec.ts` — Expected: FAIL (`writeKeyFor` not exported, rows missing).
- [ ] **Step 3: Implement** the types, `writeKeyFor`, the rows (extend the `component` helper with an optional `extra: Partial<ComponentRow>` or set fields after; builder's choice), and the validation.
- [ ] **Step 4: Run** `npx vitest run tests/friendly` — Expected: PASS. Then `npm run test:run`: fix tests elsewhere that pinned the old default row list/order (only expectations about the list itself; any behaviour change elsewhere is a bug to report).
- [ ] **Step 5: Commit** `feat(mapping): rows for every part of N, ORG, ADR and GENDER; 3.0 write key`

### Task 2: Patch uses the write key for the card's version

**Files:**
- Modify: `src/contacts/friendly/patch.ts`
- Test: `tests/friendly/patch.spec.ts`, `tests/friendly/toFriendly.spec.ts`

**Interfaces:**
- Consumes: `writeKeyFor` (Task 1).
- Produces: no new exports. `COMPONENT_COUNT` stays `{ ADR: 7, N: 5, ORG: 2 }`: other fields get as many parts as are set, so a new gender line is `GENDER:M`, not `GENDER:M;`.

- [ ] **Step 1: Write failing tests** (use `DEFAULT_MAPPING` unless stated):
  - `newCard({ name: 'A', gender: 'M' }, rows, ctx, '4.0')` has line `GENDER:M` and no `X-GENDER`; with `'3.0'` it has `X-GENDER:M` and no `GENDER`.
  - `newCard({ name: 'A', gender: 'O', 'gender-identity': 'non-binair' }, …, '3.0')` has exactly one gender line: `X-GENDER:O;non-binair`.
  - Patch of a 3.0 card holding `GENDER:M` with `gender: 'F'` → that line becomes `GENDER:F`, no `X-GENDER` added; a 4.0 card holding `X-GENDER:Male` edited to `F` stays `X-GENDER:F`.
  - `GENDER:O;non-binair` with `gender` cleared → `GENDER:;non-binair`; with both cleared → the line is gone.
  - `ORG:A\;B;Sales`: `toFriendly` gives `company: 'A;B'`, `department: 'Sales'`; patching `department: 'Ops'` gives `ORG:A\;B;Ops`.
  - `N:Jansen;Jan;;Dr;Jr` → `name-prefix: 'Dr'`, `name-suffix: 'Jr'`; a new 3.0 card with `name-prefix` only has `N:;;;Dr;`.
  - New home address with only `po-box: '12'` on 4.0 → `ADR;TYPE=HOME:12;;;;;;`.
  - Genericity: a custom field row `{ kind:'field', property:'x', read:['X-FOO'], write:'X-FOO', writeV3:'X-BAR' }` writes `X-BAR` on a new 3.0 line, `X-FOO` on 4.0, and an existing `X-FOO` on a 3.0 card stays `X-FOO` on edit.
  - Untouched lines keep their raw text (compare serialized card minus edited line and `REV`).
- [ ] **Step 2: Run** `npx vitest run tests/friendly/patch.spec.ts tests/friendly/toFriendly.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement**: a private `writeKey(s: State, row: FieldRow | ComponentRow): string` = `writeKeyFor(row, cardVersion(s))`, used in `patchField`'s `addLine`, `patchDate`'s plain branch, `patchPhoto`'s fallback and `patchComponent`. In `patchComponent`, key `s.newParts` by the key actually written and look up `COMPONENT_COUNT` by its parsed name. `anniversary` output must stay identical (existing tests prove it).
- [ ] **Step 4: Run** `npx vitest run tests/friendly` then `npm run test:run` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(patch): new lines use the row's vCard 3.0 write key on 3.0 cards`

### Task 3: Migration adds the new rows once

**Files:**
- Modify: `src/contacts/friendly/mapping.ts`, `src/settings/settings.d.ts` (`FriendlySettings.defaultRowsSeen?: number`), `src/settings/setting.ts` (default `defaultRowsSeen: DEFAULT_ROWS_SET`), `src/context/sharedSettingsContext.ts` (`normalizeLoaded`)
- Test: `tests/friendly/mapping.spec.ts`, `tests/context.spec.ts` (or the spec that covers `initSettings`; find it with `grep -l initSettings tests`)

**Interfaces:**
- Consumes: Task 1 rows.
- Produces:
  - `export const DEFAULT_ROWS_SET = 1;`
  - `export function addDefaultRows(stored: MappingRow[], seen: number): { rows: MappingRow[]; seen: number }` — when `seen >= DEFAULT_ROWS_SET` returns `stored` unchanged (new array not required) and `seen`; else adds the rows and returns `seen: DEFAULT_ROWS_SET`.
  - `normalizeLoaded`: `friendly: { mapping, defaultRowsSeen }` from `addDefaultRows(migrateMapping(loaded mapping), loaded.friendly?.defaultRowsSeen ?? 0)`. Keep `migrateMapping` itself unchanged.

Rules for `addDefaultRows` (spec "Migration"):
- Each new default row (those with `sinceReader: 3`) is skipped when the stored mapping has a row with the same property name, or a component row with the same identity as the row would get after copying (write key compared case-insensitively, same index). `gender` and `gender-identity` are both skipped when any stored row reads `GENDER` or `X-GENDER` (pattern name, ignoring case and types).
- Sibling: the default row on the same field written before it in `DEFAULT_MAPPING` order that is not new (for `name-prefix`/`name-suffix`: `firstname`; `department`: `company`; `po-box`/`address-extra`: `street`; work: `work-street`). Its stored counterpart is the stored component row with the default sibling's identity (`write` case-insensitive + index), else the stored row with the sibling's default property name. When found, the new row takes its `read`, `write` and `writeV3` (copied arrays). `gender-identity` copies from the `gender` row just added. Do not hard-code this table: derive siblings from `DEFAULT_MAPPING` (same `write` and `read` as the new row, not new).
- Position: right after the stored counterpart of the nearest earlier default row (any kind) that exists in the stored mapping; else at the end. Rows added in this call count as stored for later rows.

- [ ] **Step 1: Write failing tests:**
  - A stored `DEFAULT_MAPPING` minus all `sinceReader` rows, `seen` 0 → equals `DEFAULT_MAPPING` (same order), `seen` 1.
  - Same input with `seen` 1 → unchanged (a removed row does not come back).
  - Running `addDefaultRows` twice → second call changes nothing.
  - Stored `street`…`work-country` with `write: 'ADR;TYPE=home'` and `read: ['ADR[HOME]']` on home rows → `po-box`/`address-extra` get that write and read; `newCard` with `po-box` and `street` set gives one `ADR` line.
  - `company` renamed to `firm` → `department` still added after `firm`, copying its keys.
  - A stored row named `department` (any kind) → no second one; a stored field row reading `X-GENDER` → neither gender row added.
  - Relation rows and the anniversary row are unchanged by the call.
  - Settings: `initSettings` with data `{ friendly: { mapping: <old defaults> } }` saves a mapping that includes `department` and `friendly.defaultRowsSeen === 1`; with `defaultRowsSeen: 1` and no `department` it stays without.
- [ ] **Step 2: Run** `npx vitest run tests/friendly/mapping.spec.ts tests/context.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `addDefaultRows`, the settings field, `normalizeLoaded`. Check that the settings UI save path (`propertyNamesSettings.tsx` `save`) keeps `defaultRowsSeen` (it spreads `current.friendly`; add a test if it does not).
- [ ] **Step 4: Run** `npm run test:run` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(settings): add the new default rows once to stored mappings`

### Task 4: Reader 3 — no removals or renames from newly visible parts

**Files:**
- Modify: `src/contacts/friendly/translate.ts` (`Reader`, `CURRENT_READER`, `readerOf`), `src/contacts/friendly/dateLabels.ts` (`rowsForBase`, `withUnfilledDates`), `src/sync/syncContact.ts` (base rows, `PreparedSync.nameBase`), `src/sync/syncFlow.ts:260` (rename check), `src/contacts/obsidianNotes.ts:456-458` (export)
- Test: `tests/friendly/dateLabels.spec.ts`, `tests/syncContact.spec.ts`, `tests/syncFlow.spec.ts`, plus the export test file (find with `grep -ln withUnfilledDates\\|exportNote tests`)

**Interfaces:**
- Consumes: `sinceReader` (Task 1).
- Produces:
  - `export type Reader = 1 | 2 | 3; export const CURRENT_READER: Reader = 3;` `readerOf(stored)`: 3 when `stored >= 3`, 2 when `stored === 2`, else 1.
  - `rowsForBase(rows: MappingRow[], storedAt: number | undefined, reader: Reader = CURRENT_READER): MappingRow[]` — also drops non-relation rows with `sinceReader !== undefined && sinceReader > reader`.
  - `withUnfilledDates(note, base, rows, storedAt, reader: Reader = CURRENT_READER)` — uses the new `rowsForBase`; name unchanged.
  - `PreparedSync.nameBase?: Props` — base props for the rename check: the base read with the base's rows, plus (via `withUnfilledDates`) the values of the base read with all rows for rows left out.
  - `syncFlow` rename check uses `review.nameBase ?? review.base ?? review.local`.

- [ ] **Step 1: Write failing tests:**
  - `rowsForBase(DEFAULT_MAPPING, undefined, 2)` has no `department`; with reader 3 it does; reader 1 likewise excludes; labelled-date `since` filtering unchanged.
  - `readerOf(3) === 3`, `readerOf(2) === 2`, `readerOf(undefined) === 1`.
  - syncContact: server card `ORG:Acme;Sales`, `N:Jansen;Jan;;Dr;`, `GENDER:M`, base = same raw stored with reader 2, note has `company: Acme`, firstname/lastname, no new properties → result is a review whose rows mark `department`, `name-prefix`, `gender` as server additions (taken into the note by default), no row offers removal from the card; applying the defaults leaves the card unchanged and the note gets the three values; the stored base then has reader 3.
  - Same card, note lacking those values, base stored with reader 3 → removal offered (the existing removal behaviour).
  - Same card with no new parts at all (only `ORG:Acme`) and a reader-2 base → `upToDate`, and the base is stored again with reader 3.
  - Hand-written `department: Marketing` in the note, card `Sales`, reader-2 base → a conflict row for `department` (no silent choice).
  - Rename: note file name computed as `Jan Jansen`, card `N:Jansen;Jan;;Dr;`, reader-2 base → no rename offer; a later change of `name-prefix` in the note (base reader 3) → rename offered.
  - Export: note without `department`, base (reader 2) with `ORG:Acme;Sales` → exported card keeps `ORG:Acme;Sales`.
- [ ] **Step 2: Run** the test files above — Expected: FAIL.
- [ ] **Step 3: Implement.** In `syncContact.ts` pass `readerOf(baseEntry?.reader)` to `rowsForBase`; keep the up-to-date re-store condition `baseRows.length < deps.rows.length`. Compute `nameBase` only when `baseRows.length < deps.rows.length` (else it equals `base`). In `obsidianNotes.ts` pass `readerOf(base.reader)` to `withUnfilledDates`. Check every other `toFriendly`/`readerOf`/`rowsForBase` caller (`grep -rn "readerOf\|rowsForBase\|withUnfilledDates" src`), including `src/contacts/labelledDates.ts`, and say in the report what each does with reader 3.
- [ ] **Step 4: Run** `npm run test:run` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(sync): reader 3; parts that become visible arrive from the card, never as removals or renames`

### Task 5: The table — Part and two write columns

**Files:**
- Modify: `src/ui/settings/components/propertyNamesSettings.tsx`, styles if the table needs width (`styles.css`, class `vcf-mapping-table`)
- Test: `tests/ui/propertyNamesSettings.spec.ts`

**Interfaces:**
- Consumes: `writeKeyFor` not needed; `validateMapping` messages (Task 1).
- Produces: UI only.

Cells per row kind:

| | Part | Write as (vCard 4.0) | Write as (vCard 3.0) |
|---|---|---|---|
| component | `CommitInput`, value `index + 1`, label `Part for <property>` | `CommitInput` (as today) | `CommitInput`, value `writeV3 ?? ''`, placeholder `same as 4.0`, label `vCard 3.0 write key for <property>` |
| field (not anniversary) | empty | `CommitInput` | same as component |
| anniversary (`appleDateLabel` set) | empty | `CommitInput` | read-only `X-ABDATE · label <appleDateLabel>` |
| relation | empty | read-only `RELATED;TYPE=<types[0]>` | read-only `X-ABRELATEDNAMES · label <labels[0]>`, or `same as 4.0` when no non-blank label |

- Part commit: a trimmed text matching `^\d+$` and ≥ 1 sets `index = n - 1`; anything else sets `index = NaN` so `validateMapping` reports `Property "<p>" has an invalid part.` and nothing is saved (existing `commit` flow).
- 3.0 commit: trimmed; empty removes `writeV3` from the row.
- `CommitInput` must support a placeholder; add a `placeholder?: string` prop if it lacks one.
- Description text (replace the current one): explain in at most three short sentences that Part picks one part of a field made of parts (`ORG` part 2 is the department), that the 3.0 column is used for new fields on vCard 3.0 cards (empty: same as 4.0), and that changing "Read from" or "Part" does not refill notes. Keep the read-pattern example.

- [ ] **Step 1: Write failing tests:** headers are exactly the five names; `department` row's Part input shows `2`; committing `3` on it saves `index: 2`; committing `0`, `abc`, `1.5`, `` shows the invalid-part error and saves nothing; committing `X-ORG` in `company`'s 3.0 cell saves `writeV3: 'X-ORG'`, committing empty removes it; `gender` 3.0 cell shows `X-GENDER`; `spouse` 4.0 cell is text `RELATED;TYPE=spouse` and 3.0 text `X-ABRELATEDNAMES · label Spouse` (no inputs); `anniversary` 3.0 cell is text `X-ABDATE · label Anniversary`; a field row's Part cell has no input.
- [ ] **Step 2: Run** `npx vitest run tests/ui/propertyNamesSettings.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run test:run` and `npm run build` — Expected: PASS, no type errors.
- [ ] **Step 5: Commit** `feat(settings): Part and vCard 3.0 columns in the property names table`

### Task 6: README and e2e

**Files:**
- Modify: `README.md` (property names section around lines 485–510; "Basic Contact Information" `GENDER` example), `tests/e2e/radicale.e2e.ts`

- [ ] **Step 1: e2e test** (next free number after the highest existing `it('NN.` in the file): on a 3.0 card and a 4.0 card in Radicale, a note sets `department`, `name-prefix`, `gender`, `gender-identity`; Sync writes `ORG:<company>;<department>`, `N:…;<prefix>;`, and `GENDER:O;non-binair` (4.0) / `X-GENDER:O;non-binair` (3.0); a second Sync is up to date. Then a card with `ORG:Acme;Sales` stored as base with reader 2 → Sync brings `department: Sales` into the note and leaves the card unchanged.
- [ ] **Step 2: Run** `npm run test:e2e` — Expected: PASS (skips without Python; report if skipped).
- [ ] **Step 3: README:** the table description (Part, two write columns, Read/Part edits don't refill notes); list of the new rows; the `GENDER` example (`M`, `F`, `O`, `N`, `U`, optional `;identity`; 3.0 uses `X-GENDER`); phones don't show gender; "Update the plugin on every desktop before syncing from it": an old version would offer to remove the newly visible parts.
- [ ] **Step 4: Run** `npm run test:run` and `npm run build` — Expected: PASS.
- [ ] **Step 5: Commit** `docs(readme): every part visible, Part and vCard 3.0 columns; e2e`
