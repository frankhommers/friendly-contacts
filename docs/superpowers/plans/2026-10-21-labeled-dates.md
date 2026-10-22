# Dates with a label Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A date a phone stores with its own label ("Verkering") shows in the note under an English property the owner
chooses, and a date filled in in the note goes to the card with that label.

**Architecture:** A labelled date is an ordinary mapping row: a `field` row with `format: 'date'`, `write: 'X-ABDATE'`,
`read: []` and `appleDateLabel: <label>`. Reading already matches `X-ABDATE` by `appleDateLabel`; writing gains the
labelled form on vCard 4.0 too. Adding a row first fills the property in every contact note from that contact's
stored sync base (read the way Sync reads it), so base, card and note agree and Sync never sees a removal. A new
group "Dates with a label" in the Property names settings adds, renames and removes these rows.

**Tech Stack:** TypeScript, Obsidian API, React (settings), vitest (unit), vitest + Radicale 3.8.3 (e2e).

**Spec:** `docs/superpowers/specs/2026-10-20-labeled-dates-design.md`

## Global Constraints

- New dates are written as `itemN.X-ABDATE:<date>` + `itemN.X-ABLabel:<label>` on **both** vCard 3.0 and 4.0; the
  label as the row has it (`writeLabel`: only built-in Apple labels get `_$!<…>!$_`).
- The `anniversary` row keeps its behaviour (4.0: `ANNIVERSARY`, 3.0: labelled `X-ABDATE`).
- A card's `VERSION` never changes; untouched lines stay byte-identical.
- Adding a row must never make Sync remove that date from cards.
- Removing a row never touches cards; it removes the property (`prop`, `prop-2`, …) from the notes after a
  confirmation.
- Several dates with one label: `prop`, `prop-2`, … (the existing `nameFor` ordinals).
- Reset to defaults keeps the labelled-date rows.
- Property names are validated like any other (unique, not fixed/reserved, not a vCard name).
- Dates without a label stay on the card, unmapped (out of scope).
- Git: never add `Co-Authored-By` or mention an LLM/agent in commit messages.
- UI text and code in English; property suggestions are mechanical only (lower-case, whitespace to `-`).

## Review Focus

1. Label spelling differs between card and row (`verkering`, `VERKERING`, `_$!<Verkering>!$_`): it is the same
   label — Task 1 and Task 2 tests.
2. The owner adds a row whose label is already taken (another row, or `Anniversary`): refused with an error, nothing
   saved — Task 1 test.
3. A note already holds the property (typed by hand) when the row is added: the note's value is kept, never
   overwritten by the fill — Task 1 test (`planDateFill`).
4. A base stored by reader 1 (before Part 6, labels unknown): reading it yields no date, so nothing is filled and Sync
   shows the date as the phone's addition, not as a removal — Task 1 test.
5. Two dates with the same label on one card: both read (`dating`, `dating-2`), both removed from the note when the
   row is removed, the card untouched — Task 1 and Task 2 tests.

---

### Task 1: Labelled-date rows, label discovery and fill planning (pure)

**Files:**
- Create: `src/contacts/friendly/dateLabels.ts`
- Modify: `src/contacts/friendly/mapping.ts` (`rowIdentity`, `validateMapping`)
- Test: `tests/friendly/dateLabels.spec.ts`, `tests/friendly/mapping.spec.ts`

**Interfaces:**
- Produces (exported from `dateLabels.ts`, no obsidian imports; `isLabelledDateRow`, `readableLabel` and the
  `LabelledDateRow` type are defined in `mapping.ts`, which needs them, and re-exported from `dateLabels.ts`):
  - `type LabelledDateRow = FieldRow & { format: 'date'; write: 'X-ABDATE'; appleDateLabel: string }`
  - `isLabelledDateRow(row: MappingRow): row is LabelledDateRow` — field row, `format: 'date'`, write key name
    `X-ABDATE` (case-insensitive), `appleDateLabel` set. The anniversary row is **not** one.
  - `labelledDateRow(label: string, property: string): LabelledDateRow` — `{ kind: 'field', property, read: [],
    write: 'X-ABDATE', format: 'date', appleDateLabel: label }`, both trimmed.
  - `suggestPropertyName(label: string): string` — trim, lower-case, whitespace runs to `-`.
  - `readableLabel(raw: string): string` — Apple's `_$!<X>!$_` unwrapped, trimmed, case kept.
  - `insertLabelledDateRow(rows: MappingRow[], row: LabelledDateRow): MappingRow[]` — new array; inserted right after
    the last row with `format: 'date'`, else at the end.
  - `withLabelledDateRows(defaults: MappingRow[], current: MappingRow[]): MappingRow[]` — `defaults` plus every
    labelled-date row of `current`, in their order, each inserted with `insertLabelledDateRow`.
  - `rowPropertyKeys(frontmatter: Record<string, unknown>, row: MappingRow): string[]` — keys of `frontmatter` that
    belong to `row` (`rowForProperty(key, [row])` finds it), in key order.
  - `unmappedDateLabels(cards: VCardLine[][], rows: MappingRow[]): { label: string; contacts: number }[]` — every
    `X-ABDATE` group label (readable form) that no row with an `appleDateLabel` matches, counted once per card;
    spellings that differ only in case are one label (first spelling seen); labels holding a comma are left out (a
    row cannot match them); sorted by `contacts` descending, then label.
  - `planDateFill(notes: FillNote[], rows: MappingRow[], row: LabelledDateRow): { path: string; set: Record<string, string> }[]`
    with `type FillNote = { path: string; frontmatter: Record<string, unknown>; base?: { raw: string; reader: Reader } }`.
    For each note with a base: `toFriendly(parseCard(base.raw), rows, NO_LOOKUPS, { reader: base.reader }).props`,
    keep the keys of `row` (`rowPropertyKeys`), drop keys the note already holds a non-empty value for. Notes with
    nothing to set are left out.
  - `const NO_LOOKUPS: RelationContext` — `uidToName`/`displayName` return `undefined`, `resolveLink` returns
    `{ text: name }` (relations are read but their values are discarded).
- Changes in `mapping.ts`:
  - `rowIdentity` of a labelled-date row: `date-label|<readableLabel(label).toLowerCase()>` (they all write `X-ABDATE`,
    so `field|X-ABDATE` would pair them by position).
  - `validateMapping`: a labelled-date row may have an empty `read`. New errors, exact text:
    - `A date has no label.` (empty `appleDateLabel` on a labelled-date row)
    - `The label "${label}" cannot hold a comma.`
    - `Two dates have the label "${label}".` (any two rows with `appleDateLabel`, anniversary included, compared by
      `readableLabel(...).toLowerCase()`)

- [ ] **Step 1: Write the failing tests** in `tests/friendly/dateLabels.spec.ts` and `tests/friendly/mapping.spec.ts`:
  - `labelledDateRow(' Verkering ', ' dating ')` equals `{ kind: 'field', property: 'dating', read: [], write: 'X-ABDATE', format: 'date', appleDateLabel: 'Verkering' }`; `isLabelledDateRow` is true for it and false for the default anniversary row.
  - `suggestPropertyName('Eerste  Kus')` is `'eerste-kus'`.
  - `readableLabel('_$!<Other>!$_')` is `'Other'`; `readableLabel(' Verkering ')` is `'Verkering'`.
  - `insertLabelledDateRow(DEFAULT_MAPPING, dating)` puts `dating` right after `anniversary`; a second row goes right after `dating`; `withLabelledDateRows(DEFAULT_MAPPING, [...current with dating renamed fields])` keeps `dating`.
  - `rowPropertyKeys({ dating: 'x', 'dating-2': 'y', datings: 'z', name: 'A' }, dating)` is `['dating', 'dating-2']`.
  - `unmappedDateLabels` on three cards (`Verkering` on two, `verkering` spelled lower-case on one of them twice, `_$!<Anniversary>!$_` on one, `_$!<Other>!$_` on one, `A, B` on one, an unlabelled `X-ABDATE` on one) with `DEFAULT_MAPPING` gives `[{ label: 'Verkering', contacts: 2 }, { label: 'Other', contacts: 1 }]`; with a `Verkering` row added it gives `[{ label: 'Other', contacts: 1 }]`.
  - `planDateFill`: base `item3.X-ABDATE:2012-05-01` + `item3.X-ABLabel:Verkering` (reader 2) and an empty note gives `[{ path, set: { dating: '2012-05-01' } }]`; two `Verkering` dates give `dating` and `dating-2`; a note holding `dating: '2013-01-01'` gets nothing (Review Focus 3); the same base with reader 1 gives `[]` (Review Focus 4); a note without base gives `[]`; a 3.0 base with `item3.X-ABDATE;X-APPLE-OMIT-YEAR=1604:1604-05-01` fills `--05-01`.
  - `validateMapping(insertLabelledDateRow(DEFAULT_MAPPING, dating))` is `[]`; with label `anniversary` it holds `Two dates have the label "anniversary".`; two rows `Verkering`/`VERKERING` give the duplicate error (Review Focus 2); label `A, B` gives the comma error; label `''` gives `A date has no label.`
  - `mappingRenames(withDating, withDatingRenamedTo('started-dating'))` is `[{ from: 'dating', to: 'started-dating' }]` with two labelled rows present; adding or removing a labelled row gives `[]`.

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/friendly/dateLabels.spec.ts tests/friendly/mapping.spec.ts`
Expected: FAIL (module `dateLabels` not found; mapping assertions fail).

- [ ] **Step 3: Implement** `dateLabels.ts` and the `mapping.ts` changes with the signatures above.

- [ ] **Step 4: Run the tests to see them pass, then the whole unit suite**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/contacts/friendly/dateLabels.ts src/contacts/friendly/mapping.ts tests/friendly/dateLabels.spec.ts tests/friendly/mapping.spec.ts
git commit -m "feat(dates): mapping rows for dates with a label"
```

### Task 2: Read and write labelled dates on cards

**Files:**
- Modify: `src/contacts/friendly/patch.ts` (`patchDate`, around line 149)
- Test: `tests/friendly/toFriendly.spec.ts`, `tests/friendly/patch.spec.ts`

**Interfaces:**
- Consumes: `labelledDateRow`, `insertLabelledDateRow` (Task 1).
- Produces: no new exports. `patchDate` writes a new line as a labelled group when the row has an
  `appleDateLabel` and either the card is 3.0 or the row's write key is `X-ABDATE` (so 4.0 anniversaries keep
  `ANNIVERSARY`).

- [ ] **Step 1: Write the failing tests** with `rows = insertLabelledDateRow(DEFAULT_MAPPING, labelledDateRow('Verkering', 'dating'))`:
  - toFriendly: `item3.X-ABDATE:2012-05-01` + `item3.X-ABLabel:Verkering` reads `dating: '2012-05-01'` on 3.0 and 4.0; labels `verkering` and `_$!<Verkering>!$_` read too (Review Focus 1); `_$!<Anniversary>!$_` still reads `anniversary`; an unlabelled `X-ABDATE` reads nothing; two `Verkering` groups read `dating` and `dating-2`.
  - patch, adding `dating: '2012-05-01'`: on a 3.0 card the added lines serialize as `itemN.X-ABDATE:2012-05-01` and `itemN.X-ABLabel:Verkering` with `N` above every existing item number; on a 4.0 card as `itemN.X-ABDATE:20120501` + `itemN.X-ABLabel:Verkering`; year-less `--05-01` gives `itemN.X-ABDATE;X-APPLE-OMIT-YEAR=1604:1604-05-01` on 3.0 and `itemN.X-ABDATE:--0501` on 4.0; every other line keeps its `raw` text and `VERSION` is unchanged.
  - patch, adding `anniversary: '2012-06-21'` on 4.0 still writes `ANNIVERSARY:20120621` (no group).
  - patch, changing `dating` edits the value in place (group and label stay); removing `dating` removes the line and its `X-ABLabel`; removing `dating-2` of two leaves the first group intact (Review Focus 5).

- [ ] **Step 2: Run them to see the 4.0 write tests fail**

Run: `npx vitest run tests/friendly/toFriendly.spec.ts tests/friendly/patch.spec.ts`
Expected: FAIL only on the 4.0 labelled-write cases (bare `X-ABDATE` without a group); reading already works.

- [ ] **Step 3: Change the condition in `patchDate`** to write `labelled(s, 'X-ABDATE', …, row.appleDateLabel)` when
  `row.appleDateLabel !== undefined && (!isV4(s) || parseWriteKey(row.write).name === 'X-ABDATE')`.

- [ ] **Step 4: Run the whole unit suite**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/contacts/friendly/patch.ts tests/friendly/toFriendly.spec.ts tests/friendly/patch.spec.ts
git commit -m "feat(dates): write dates with a label on vCard 4.0 cards too"
```

### Task 3: Settings group "Dates with a label", note fill and removal

**Files:**
- Create: `src/contacts/labelledDates.ts` (obsidian side: gathers notes and bases, writes notes)
- Create: `src/ui/settings/components/dateLabelsSettings.tsx`
- Modify: `src/ui/settings/components/propertyNamesSettings.tsx`
- Modify: `styles.css` only if the existing `vcf-mapping-table` styles do not fit
- Modify: `README.md` (new subsection `### 📅 Dates with a label` right after `### 📱 Relationships on phones`)
- Test: `tests/labelledDates.spec.ts` (fake `app` like `tests/layoutNotes.spec.ts`)

**Interfaces:**
- Consumes: everything in Task 1; `contactNotes(app)`, `contactSyncState(id, app)` (`src/contacts/obsidianNotes.ts`),
  `sourceForExport` (`src/sync/sources.ts`), `readerOf` (`translate.ts`), `getSettings()`, `ConfirmModal(app, message,
  confirmText, onConfirm, cancelText, onCancel)`.
- Produces in `labelledDates.ts`:
  - `notesWithBases(app: App): Promise<FillNote[]>` — every contact note with its frontmatter (metadata cache) and, when
    it has a `uid`, the base from `sourceForExport(fm.source, settings, id => state(id).get(uid) !== undefined)`.
  - `findDateLabels(app: App, rows: MappingRow[]): Promise<{ label: string; contacts: number }[]>` —
    `unmappedDateLabels` over the parsed bases of `notesWithBases`.
  - `fillNotes(app: App, fills: { path: string; set: Record<string, string> }[]): Promise<{ filled: number; failed: string[] }>`
    — `processFrontMatter`, setting only keys still empty at write time.
  - `notesWithRowProperties(app: App, row: MappingRow): TFile[]` and
    `removeRowProperties(app: App, row: MappingRow): Promise<{ removed: number; failed: string[] }>` (uses
    `rowPropertyKeys`).
- `DateLabelsSettings` props: `{ app: App; rows: MappingRow[]; revision: number; onRename(index: number, to: string): void;
  onAdd(label: string, property: string): Promise<void>; onRemove(index: number): void }` — `index` is the index in
  `rows`.

Behaviour (decisions; the implementer writes the code):
- The main Property names table no longer shows labelled-date rows (indices into `rows` are kept).
- The new group comes right after the main table: heading **Dates with a label**, description: `Dates a phone keeps
  under a label of its own, such as "Verkering". Give each label a property for your notes, in English, e.g.
  dating. Dates without a label are not shown.` Columns **Label on the card**, **Property in the note**, and a
  **Remove** button. The label is read-only text in every row (to change it: remove the row and add it again).
  First row: the anniversary row (label `Anniversary`, read-only; its property renamable through
  `onRename`; no Remove).
- An add line: inputs **Label** and **Property**, button **Add**.
- Button **Find labels on cards** lists `findDateLabels` results as `Verkering — on 2 contacts` with an **Add** button
  each, which puts the label and `suggestPropertyName(label)` into the add line and focuses Property (so the owner
  types the English name before anything is written; a deliberate change from the spec's "Add creates the row", so
  notes are never filled under a name that is renamed a moment later). Empty result: `No other labels on the cards of your contacts.`
  Description under the button: `Reads the cards as they were at each contact's last Sync.`
- `onAdd` in `PropertyNamesSettings`: build `next = insertLabelledDateRow(saved.current, labelledDateRow(label,
  property))`; `validateMapping(next)` errors show in the existing error box and nothing is saved; fills =
  `planDateFill(await notesWithBases(app), next, row)`; none: save. Otherwise confirm `Add ${property} to ${n} contact
  notes, from their last Sync?` (button `Add`): fill **first**, then save; when any fill fails, do not save and show
  `Not added: ${k} contact notes could not be filled, see console.` On success Notice `Added ${property} to ${n}
  contact notes.`
- `onRemove`: `next` without the row; count `notesWithRowProperties`; none: save. Otherwise confirm `Remove ${property}
  from ${n} contact notes? The dates stay on the cards.` (button `Remove`): save **first**, then remove; Notice
  `Removed ${property} from ${removed} contact notes` plus `; ${failed} failed, see console` when any failed.
- Renames go through the existing `rename(index, to)` (unchanged rules and confirmation).
- `reset` saves `withLabelledDateRows(DEFAULT_MAPPING, saved.current)`.
- README: what the group does, the advice to use English names, that "Find labels on cards" reads the last-synced
  cards (sync a contact first to see a label added on the phone since), and that dates without a label are not shown.

- [ ] **Step 1: Write the failing tests** in `tests/labelledDates.spec.ts` with a fake app holding two contact notes
  (`Contacts/Anna.md` with uid `anna`, `Contacts/Bob.md` without base) and a sync state for `radicale` holding
  Anna's base with a `Verkering` date:
  - `notesWithBases` returns Anna with her base (reader taken from the entry) and Bob without one.
  - `findDateLabels(app, DEFAULT_MAPPING)` is `[{ label: 'Verkering', contacts: 1 }]`.
  - `fillNotes` sets `dating` in Anna's frontmatter and leaves a key that became non-empty in between alone.
  - `removeRowProperties(app, datingRow)` removes `dating` and `dating-2` from Anna, nothing else, and reports `removed: 1`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/labelledDates.spec.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `labelledDates.ts`, `DateLabelsSettings`, the `PropertyNamesSettings` changes and the README.

- [ ] **Step 4: Run the unit suite and the build**

Run: `npx vitest run && npm run build`
Expected: all pass; the build reports no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/contacts/labelledDates.ts src/ui/settings/components/dateLabelsSettings.tsx src/ui/settings/components/propertyNamesSettings.tsx tests/labelledDates.spec.ts README.md styles.css
git commit -m "feat(dates): settings for dates with a label"
```

### Task 4: End-to-end against Radicale

**Files:**
- Modify: `tests/e2e/radicale.e2e.ts`

**Interfaces:**
- Consumes: `labelledDateRow`, `insertLabelledDateRow`, `planDateFill` (Task 1).
- The harness gets `let mapping: MappingRow[] = DEFAULT_MAPPING;`, used by `syncNote` (`rows`) and `importFrom`
  instead of `DEFAULT_MAPPING`; the new test sets it back in a `finally`.

- [ ] **Step 1: Write test 18** `18. a date with a label: adding its row never removes it, and a new one lands with its label`:
  - PUT a DAVx5-shaped 3.0 card holding `item1.X-ABDATE:2012-05-01` + `item1.X-ABLabel:Verkering`; import it with
    `DEFAULT_MAPPING`: the note has no `dating`; Sync is `unchanged`.
  - `mapping = insertLabelledDateRow(DEFAULT_MAPPING, labelledDateRow('Verkering', 'dating'))`; apply
    `planDateFill([{ path, frontmatter: note.frontmatter, base }], mapping, row)` to the note (base from the book's state);
    the note now has `dating: '2012-05-01'`; Sync is `unchanged` and the card still holds both lines (the anti-goal).
  - Set `dating-2: '2020-02-02'` in the note; Sync is `pushed`; the only new lines are `itemN.X-ABDATE:2020-02-02`
    and `itemN.X-ABLabel:Verkering`; the next Sync is `unchanged`.
  - The same addition on a 4.0 card gives `itemN.X-ABDATE:20200202` + `itemN.X-ABLabel:Verkering`.

- [ ] **Step 2: Run the e2e suite**

Run: `npm run test:e2e`
Expected: all pass (18 included); the existing tests unchanged.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/radicale.e2e.ts
git commit -m "test(e2e): dates with a label round-trip through Radicale"
```
