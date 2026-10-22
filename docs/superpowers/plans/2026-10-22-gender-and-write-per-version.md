# Gender and "Write as" per vCard version — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `gender` property (vCard 4.0 `GENDER`, 3.0 `X-GENDER`), driven by a generic optional 3.0 write key on mapping rows, and a property names table that shows per version what is written.

**Architecture:** Field and component rows get `writeV3?` (used for *new* lines on non-4.0 cards) and `sinceReader?` (the row is new in that reader: bases stored with an older reader are read without it). `gender` is a component row (index 0) on `GENDER`. The reader goes from 2 to 3. The settings table splits "Write as" into a 4.0 and a 3.0 column; what is hard-wired today (anniversary, relations) shows as read-only text.

**Tech Stack:** TypeScript, React (settings UI), Vitest (`npm run test:run`), e2e against Radicale (`npm run test:e2e`), `npm run build`.

**Spec:** `docs/superpowers/specs/2026-10-22-gender-and-write-per-version-design.md`

## Global Constraints

- No gender-specific code path. Everything about gender is data in its mapping row.
- Existing lines keep their name and form on edit (an existing `GENDER` on 3.0 stays `GENDER`, `X-GENDER` on 4.0 stays `X-GENDER`); `writeV3`/`write` only name a *new* line.
- Untouched lines byte-identical; `VERSION` never changes.
- Cards for every existing row come out identical to today, on both versions.
- The note holds the value as on the card (`M`, `F`); nothing is translated. Only component 0; the identity text after `;` stays on the card.
- Git: commit messages without Co-Authored-By and without any mention of an LLM/agent.

## Review Focus

1. A card with `GENDER:O;non-binary`, note letter changed to `F` → card becomes `GENDER:F;non-binary` (identity kept). Test in Task 2.
2. An existing contact whose base was stored before this release (reader 2) and whose card has `GENDER:M` → Sync puts `gender: M` in the note, card untouched, no removal offered. Test in Task 3.
3. A note with a hand-written `gender: man` on a 3.0 card without gender → `X-GENDER:man` added, no other line changes. Test in Task 2.
4. The owner renames `gender` to `geslacht` in the table → `sinceReader` stays on the row (rename keeps it), so old bases are still read without it. Test in Task 1.
5. A card with both `GENDER:M` and `X-GENDER:Male` → note gets `M` (first line), an edit changes only the `GENDER` line. Test in Task 2.

---

### Task 1: Mapping rows — `writeV3`, `sinceReader`, the `gender` row, migration, validation

**Files:**
- Modify: `src/contacts/friendly/mapping.ts` (types, `DEFAULT_MAPPING`, `migrateMapping`, `validateMapping`)
- Test: `tests/friendly/mapping.spec.ts`

**Interfaces:**
- Produces:
  - `FieldRow.writeV3?: string`, `ComponentRow.writeV3?: string` — write key for a new line on a card whose `VERSION` is not `4.0`; absent = same as `write`. Never stored blank.
  - `FieldRow.sinceReader?: number`, `ComponentRow.sinceReader?: number` — a base stored with a reader below this is read without the row.
  - Default row (placed right after `role`): `{ kind: 'component', property: 'gender', read: ['GENDER', 'X-GENDER'], write: 'GENDER', writeV3: 'X-GENDER', index: 0, sinceReader: 3 }`.
  - `migrateMapping(stored)` adds a copy of that default row when no row has property `gender` and no non-relation row's `read` contains `GENDER` or `X-GENDER` (case-insensitive). Position: right after the row with property `role` if present; else before the first component row whose `write` starts with `ADR`; else at the end.

- [ ] **Step 1: Write the failing tests** in `tests/friendly/mapping.spec.ts`:
  - `DEFAULT_MAPPING` has the gender row exactly as above, at the index right after `role`.
  - `migrateMapping(legacyMapping())` contains the gender row right after `role`; running `migrateMapping` on its own output returns an equal mapping.
  - Not added when a row is named `gender` (any kind), nor when a field row reads `X-GENDER` under another name.
  - Stored mapping without `role`: added before the `street` row.
  - `renameRow(DEFAULT_MAPPING, 'gender', 'geslacht')` keeps `writeV3: 'X-GENDER'` and `sinceReader: 3` on the renamed row.
  - `validateMapping` on DEFAULT_MAPPING with the gender row's `writeV3: '  '` → contains `Property "gender" has an empty vCard 3.0 write key.`; with `writeV3` absent → no error.
  - Existing migration tests (anniversary label, partner row) still pass unchanged.
- [ ] **Step 2: Run** `npx vitest run tests/friendly/mapping.spec.ts` — Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the types, the default row, the migration addition (keep the existing `ROWS_NEW_IN_PART_6` logic as is; the gender addition is a separate step at the end of `migrateMapping`), and the validation message (exact text above, for field and component rows).
- [ ] **Step 4: Run** `npx vitest run` — Expected: all pass. Tests elsewhere that snapshot or count `DEFAULT_MAPPING` rows (e.g. rendered note templates, settings) may need the new row added to their expectations; adjust only expectations, never behaviour.
- [ ] **Step 5: Commit** `feat(mapping): gender row and a vCard 3.0 write key per row`

### Task 2: Writing — the write key for the card's version

**Files:**
- Modify: `src/contacts/friendly/patch.ts`
- Test: `tests/friendly/patch.spec.ts`, `tests/friendly/toFriendly.spec.ts`

**Interfaces:**
- Consumes: `writeV3` from Task 1.
- Produces: private `writeKeyFor(s: State, row: FieldRow | ComponentRow): string` — `row.writeV3.trim()` when the card is not 4.0 (`!isV4(s)`) and `writeV3` is non-blank, else `row.write`. Used for every *new* line built from a row's write key: `patchField` (`addLine`), `patchDate` (the non-labelled `addLine` branch only; the anniversary `X-ABDATE` branch stays as is), `patchPhoto`'s fallback `addLine`, and `patchComponent` (both the `newParts` map key and `COMPONENT_COUNT` lookup use the chosen key). `newCard` gets it through `patch`.

- [ ] **Step 1: Write the failing tests:**
  - `toFriendly.spec.ts`: `GENDER:M` (4.0) → `gender: 'M'`; `GENDER:O;non-binary` → `gender: 'O'`; 3.0 `X-GENDER:Male` → `gender: 'Male'`; a card with `GENDER:M` and `X-GENDER:Male` → `gender: 'M'` and no `gender-2`.
  - `patch.spec.ts` (use `card(...)` for 3.0 and `card4(...)` for 4.0; compare `texts(...)`):
    - 4.0 card without gender, note adds `gender: 'F'` → one line `GENDER:F` added, every other line identical.
    - 3.0 card, same → `X-GENDER:F` added.
    - 3.0 card with `GENDER:M`, note `F` → that line becomes `GENDER:F` (name kept); 4.0 card with `X-GENDER:M` → `X-GENDER:F`.
    - `GENDER:O;non-binary`, note `F` → `GENDER:F;non-binary`.
    - Note removes gender from `GENDER:M` → line removed; from `GENDER:O;non-binary` → `GENDER:;non-binary` (component rows keep other parts, like `ORG`; pin whichever the existing `finishComponents` rule gives and assert it).
    - Card with `GENDER:M` and `X-GENDER:Male`, note `F` → only the `GENDER` line changes.
    - 3.0 card, hand-written `gender: 'man'` → `X-GENDER:man` added.
    - Generic: a mapping where `nickname` has `writeV3: 'X-NICK'` → a new nickname on a 3.0 card is written `X-NICK:…`, on 4.0 `NICKNAME:…` (proves the rule is not about gender).
    - `newCard({ name: 'A', gender: 'M' }, DEFAULT_MAPPING, ctx, '3.0')` has `X-GENDER:M`; with `'4.0'` has `GENDER:M`.
    - Regression: the existing patch tests for anniversary and relations on 3.0 and 4.0 pass unchanged.
- [ ] **Step 2: Run** `npx vitest run tests/friendly` — Expected: new tests FAIL.
- [ ] **Step 3: Implement** `writeKeyFor` and use it at the places listed.
- [ ] **Step 4: Run** `npx vitest run` — Expected: all pass.
- [ ] **Step 5: Commit** `feat(patch): write a row's vCard 3.0 key on 3.0 cards`

### Task 3: Reader 3 — old sync bases are read without rows new since then

**Files:**
- Modify: `src/contacts/friendly/translate.ts` (`Reader`, `CURRENT_READER`, `readerOf`), `src/contacts/friendly/dateLabels.ts` (`rowsForBase`, `withUnfilledDates`), `src/sync/syncContact.ts` (caller, around line 180), `src/contacts/obsidianNotes.ts` (export path, around line 456)
- Test: `tests/friendly/dateLabels.spec.ts`, `tests/syncContact.spec.ts`, `tests/convertNotes.spec.ts`

**Interfaces:**
- Consumes: `sinceReader` from Task 1.
- Produces:
  - `type Reader = 1 | 2 | 3`; `CURRENT_READER = 3`; `readerOf(stored)` → 1 when absent or < 2, 2 when 2, 3 when ≥ 3.
  - `rowsForBase(rows: MappingRow[], storedAt: number | undefined, reader: Reader = CURRENT_READER): MappingRow[]` — also drops field/component rows whose `sinceReader` is greater than `reader`.
  - `withUnfilledDates(note, base, rows, storedAt, reader: Reader = CURRENT_READER)` — passes `reader` to `rowsForBase` (name stays, it now covers any row left out).
  - Callers pass `readerOf(baseEntry?.reader)` / `readerOf(base.reader)`. The `upToDate` branch in `syncContact.ts` already re-stores the base when `baseRows.length < deps.rows.length`; that now also covers reader-2 bases, so they are stored as reader 3 once both sides agree.

- [ ] **Step 1: Write the failing tests:**
  - `dateLabels.spec.ts`: `rowsForBase(DEFAULT_MAPPING, undefined, 2)` has no `gender` row; with reader 3 it has; a renamed gender row (`geslacht`, still `sinceReader: 3`) is dropped for reader 2; existing `since` tests unchanged.
  - `syncContact.spec.ts` (follow the file's existing fakes for a stored base):
    - Base stored with `reader: 2` holding `GENDER:M`, server card the same, note without gender → result: the note gets `gender: 'M'`, no write to the server, no removal row preselected.
    - Same with `reader: 3` → the review offers removing `gender` (the note removed it).
    - Reader-2 base and server and note in agreement (card without gender) → `upToDate`, and the base is stored again with `reader: 3`.
  - `convertNotes.spec.ts`: `convertFrontmatter({ FN: 'A', GENDER: 'M' }, DEFAULT_MAPPING)` sets `gender: 'M'` and removes `GENDER`.
- [ ] **Step 2: Run** those spec files — Expected: new tests FAIL.
- [ ] **Step 3: Implement** the reader bump, `rowsForBase`/`withUnfilledDates` parameter, and the two callers. Update the doc comments on `Reader`, `rowsForBase` and the `syncContact.ts` comment at line ~178 to say reader 3 introduced rows marked `sinceReader`.
- [ ] **Step 4: Run** `npx vitest run` — Expected: all pass (tests that assert `reader: 2` on stored bases now expect `3`; update those expectations only).
- [ ] **Step 5: Commit** `feat(sync): reader 3 reads older bases without the gender row`

### Task 4: Settings table — "Write as (vCard 4.0)" and "Write as (vCard 3.0)"

**Files:**
- Modify: `src/ui/settings/components/propertyNamesSettings.tsx` (table head and row cells, around lines 288–335)
- Test: `tests/ui/propertyNamesSettings.spec.ts`

**Interfaces:**
- Consumes: `writeV3` (Task 1), `readableLabel` (exists).
- Produces: column headers `Name`, `Read from`, `Write as (vCard 4.0)`, `Write as (vCard 3.0)`. Cells:
  - 4.0, relation row: read-only `<span className="vcf-mapping-readonly">RELATED;TYPE=<types[0]></span>`. Other rows: the existing `CommitInput` on `write`.
  - 3.0, relation row: read-only `X-ABRELATEDNAMES (label <labels[0]>)`, or `same as 4.0` when `labels[0]` is blank/absent.
  - 3.0, field row with `appleDateLabel` (anniversary; labelled date rows are not in this table): read-only `X-ABDATE (label <readableLabel(appleDateLabel)>)`.
  - 3.0, other field and component rows: `CommitInput` with `label={`vCard 3.0 write key for ${row.property}`}`, value `row.writeV3 ?? ''`, placeholder `same as 4.0` (add a `placeholder?: string` prop to `CommitInput` if it has none). Commit: trimmed text; blank → the row without `writeV3` (delete the key), else `writeV3` set. Saved through the existing `edit` → `commit` path.
  - The description above the table: replace the sentence about "written to" with: `The names of the properties in your contact notes, the vCard fields they are read from, and what is written on vCard 4.0 and vCard 3.0 cards. An empty vCard 3.0 field writes the same as vCard 4.0.` (keep the read-pattern example sentence).

- [ ] **Step 1: Write the failing tests:** headers render; the gender row shows `X-GENDER` in its 3.0 input; editing the `nickname` 3.0 input to `X-NICK` saves `writeV3: 'X-NICK'` on that row; clearing the gender 3.0 input saves the row without a `writeV3` key; the `spouse` row shows `RELATED;TYPE=spouse` and `X-ABRELATEDNAMES (label Spouse)` as text, with no input; `anniversary` shows `X-ABDATE (label Anniversary)` as text.
- [ ] **Step 2: Run** `npx vitest run tests/ui/propertyNamesSettings.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run` and `npm run build` — Expected: all pass, build clean.
- [ ] **Step 5: Commit** `feat(settings): show what is written on vCard 4.0 and 3.0 cards`

### Task 5: README and end-to-end

**Files:**
- Modify: `README.md`, `tests/e2e/radicale.e2e.ts`

- [ ] **Step 1: e2e test** `22. gender: GENDER on a 4.0 card, X-GENDER on a 3.0 card, round trip` in `radicale.e2e.ts`, following test 21's structure: for each version, a card on Radicale without gender, note sets `gender: F` → Sync/Apply → the server card (plain GET) has `GENDER:F` (4.0) / `X-GENDER:F` (3.0), all other lines unchanged; a second Sync is up to date. Then a card uploaded with `GENDER:M;non-binary` (4.0) imported → note `gender: M`; note → `F` → server has `GENDER:F;non-binary`.
- [ ] **Step 2: Run** `npm run test:e2e` — Expected: all pass (27 tests).
- [ ] **Step 3: README:**
  - Where the property names settings are described: the two write columns, what an empty vCard 3.0 field means, that anniversary and relationships show their vCard 3.0 form read-only.
  - The `gender` property: `M`, `F`, `O`, `N`, `U` as on the card; written `GENDER` on vCard 4.0 and `X-GENDER` on 3.0; an identity text after `;` stays on the card; phones (Android, Samsung Contacts) show no gender.
  - "Basic Contact Information" table: the `GENDER` row example becomes `` `M`, `F`, `O`, `N`, `U` `` and add a row `` `X-GENDER` `` (vCard 3.0) with the same example.
  - Update-every-desktop note: after updating, update the plugin on every desktop that syncs before syncing from it; an older version may offer to remove genders from cards.
- [ ] **Step 4: Run** `npx vitest run` and `npm run build` — Expected: all pass, build clean.
- [ ] **Step 5: Commit** `docs(readme): gender and the write columns; e2e for gender`
