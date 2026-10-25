# Sync per property Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A **Sync** checkbox per row of the property table; a row with Sync off is neither read from nor written to cards, and its lines on cards stay untouched.

**Architecture:** The stored row gets `sync?: false` and `syncSince?: number`. Sync and Import do not use the stored rows directly but `syncRows(rows)`, which marks off rows with an internal `skip: true`. The pure lookups honour `skip`: `rowForLine` blocks the line (no fall-through to another row), `rowForProperty` finds nothing. Everything built on those two (toFriendly, patch, newCard, coerceNoteProps, review, note links) then ignores the property, and its card lines fall into the existing "unknown line, keep it" path. Notes, sidebar, mirroring, graph and export keep using the stored rows, which never carry `skip`, so they are unchanged.

**Tech Stack:** TypeScript, Obsidian plugin API, React (settings), vitest, Radicale e2e.

**Spec:** `docs/superpowers/specs/2026-10-25-sync-per-property-design.md`

## Global Constraints

- Turning Sync off never changes a card or a note. Turning it back on never preselects a removal from a note.
- No special case for `friends` anywhere; the checkbox is generic.
- `uid`, `name`, `photo` (`FIXED_PROPERTIES`) are always synced: `syncRows` never skips them, their checkbox is ticked and disabled.
- A line of a row with Sync off is skipped, never passed on to another matching row.
- Export to .vcf (`src/contacts/vcard/toString.ts`, `friendlyNoteCard` in `src/contacts/obsidianNotes.ts`) is unchanged: it keeps the stored rows.
- Labelled date rows (Settings → dates with a label) are not in the property table and get no checkbox.
- Commit messages: conventional, no Co-Authored-By, no mention of an LLM or agent.
- Tests: `npx vitest run`, `npm run build`; e2e `RADICALE_PYTHON=/tmp/radtest-t6/bin/python npm run test:e2e`.

## Review Focus

1. A 4.0 line `RELATED;TYPE=friend,colleague` with `friends` off: must not feed or be edited through `colleagues` (Task 2 test).
2. A 3.0 `itemN.X-ABRELATEDNAMES` + `itemN.X-ABLabel:_$!<Friend>!$_` pair with friends off: an Apply that changes another property keeps both lines byte for byte, including the group (Task 2 test).
3. An old `urn:uuid:` friend line on a 3.0 or 4.0 card with friends off: no "Relationships on this card are rewritten" line and no rewrite (Task 2 test).
4. Re-enable after the owner cleaned the cards while the base still holds friends: the review preselects Obsidian (a write to the card), never a removal from the note; Apply all must not strip notes (Task 4 test).
5. A note with only friends differing from the card is up to date and does not show in Sync all (Task 3 test).

---

### Task 1: Rows with Sync off in the mapping

**Files:**
- Modify: `src/contacts/friendly/mapping.ts`
- Test: `tests/friendly/mapping.spec.ts`

**Interfaces:**
- Produces:
  - On `FieldRow`, `ComponentRow`, `RelationRow`: `sync?: false` (stored; absent = on), `syncSince?: number` (stored; ms since epoch when Sync was last turned on; absent = always on), `skip?: true` (internal, never stored; set only by `syncRows`/`rowsForBase`).
  - `export function syncRows(rows: MappingRow[]): MappingRow[]` — a copy where each row with `sync === false` and not `isFixedProperty(row.property)` has `skip: true`. Same length and order as `rows`.
  - `rowForLine(line, rows, label?)`: matching works as now over all rows (skipped ones included); then for a component match, the skipped component rows are dropped from the result; for a non-component match, `[]` if the first matching row is skipped.
  - `export function lineIsSkipped(line: VCardLine, rows: MappingRow[], label?: string): boolean` — true when a row with `skip` matches the line and decides it (the first matching row is skipped and is not a component, or every matching component row is skipped).
  - `rowForProperty(property, rows)`: `undefined` when the found row has `skip`.

- [ ] **Step 1: Write the failing tests** in `tests/friendly/mapping.spec.ts`, `describe('Sync off')`:
  - `syncRows` marks `friends` (sync false) with `skip`, leaves other rows unchanged, never marks `uid`/`name`/`photo` even with `sync: false`, and does not mutate its input.
  - `rowForLine` on `RELATED;TYPE=friend,colleague:...` with friends skipped (friends before colleagues as in `DEFAULT_MAPPING`) returns `[]`; with nothing skipped returns `[friends row]`.
  - `rowForLine` on `X-ABRELATEDNAMES` with label `_$!<Friend>!$_` and friends skipped returns `[]`; `lineIsSkipped` is true for it.
  - `rowForLine` on an `ORG` line with `department` skipped returns only `company`; with both skipped returns `[]` and `lineIsSkipped` is true.
  - `rowForProperty('friends', syncRows(rows))` is `undefined`; `rowForProperty('friends', rows)` (stored rows with `sync: false`) still finds the row.
  - `validateMapping` reports a duplicate name between a row with Sync off and another row as before; `migrateMapping` and `renameRow` keep `sync` and `syncSince`.

- [ ] **Step 2: Run** `npx vitest run tests/friendly/mapping.spec.ts` — expect the new tests to FAIL.
- [ ] **Step 3: Implement** the fields, `syncRows`, `lineIsSkipped`, and the `skip` handling in `rowForLine`/`rowForProperty`. Also make `addDefaultRows`/`migrateMapping` keep the new fields (they spread rows already; verify).
- [ ] **Step 4: Run** `npx vitest run` — all pass.
- [ ] **Step 5: Commit** `feat(mapping): rows with Sync off are skipped when reading and writing cards`

### Task 2: Cards keep the lines of a row with Sync off

**Files:**
- Modify: `src/contacts/friendly/patch.ts` (`legacyFix`, `needsLegacyRewrite`, `rewriteLegacy`), `src/contacts/friendly/translate.ts` only if needed
- Test: `tests/friendly/patch.spec.ts`, `tests/friendly/toFriendly.spec.ts`

**Interfaces:**
- Consumes: `syncRows`, `lineIsSkipped` (Task 1).
- Produces: no new exports; `needsLegacyRewrite(lines, rows, ctx)` and `patch(..., { rewriteLegacyRelations })` leave lines alone for which `lineIsSkipped(line, rows, label)` holds (label from the line's group, as `toFriendly` does with `groupLabels`).

- [ ] **Step 1: Write the failing tests** (all with `rows = syncRows(` DEFAULT_MAPPING with `friends` set `sync: false` `)`):
  - toFriendly: a 3.0 card with a Friend `X-ABRELATEDNAMES` pair and a Child pair gives `children` but no `friends`; a 4.0 card with `RELATED;TYPE=friend,colleague` gives neither `friends` nor `colleagues`.
  - patch: changing `email` on both cards keeps every friend line (and its `X-ABLabel`, same group) byte for byte; a `result` that holds `friends: ['[[Piet]]']` writes no friend line; `newCard` with `friends` in the props writes no friend line.
  - patch, part off: with `department` off, changing `company` keeps the card's department part of `ORG`; `newCard` with `company` and `department` in the props writes `ORG:Acme;` without the department.
  - legacy: a 3.0 card with `RELATED;TYPE=friend:urn:uuid:<uid of a known contact>` and a 4.0 card with `RELATED;TYPE=friend;VALUE=text:urn:uuid:<uid>`: `needsLegacyRewrite` is false, and `patch` with `rewriteLegacyRelations: true` leaves the line as it is. The same cards with `friends` on still need the rewrite (guards the test).
- [ ] **Step 2: Run** `npx vitest run tests/friendly` — the legacy tests FAIL (the others may already pass through Task 1; keep them as guards).
- [ ] **Step 3: Implement** the `lineIsSkipped` guard at the top of `legacyFix` (pass the group label in; `needsLegacyRewrite` and `rewriteLegacy` compute labels like `groupLabels` in translate.ts — reuse it by exporting it, do not copy it). Check `patchComponent`'s line lookup (`rowForLine(...).includes(row)`) still finds the `ORG` line when only another part is skipped.
- [ ] **Step 4: Run** `npx vitest run` — all pass.
- [ ] **Step 5: Commit** `feat(sync): cards keep the lines of a property with Sync off`

### Task 3: Sync and Import use the rows with Sync off skipped

**Files:**
- Modify: `src/sync/sync.ts` (`flowDepsFor`: `rows: syncRows(settings.friendly.mapping)`; every other place in this file that hands rows to `syncContact`/`prepareSync`/`applySync`/Sync all), `src/contacts/obsidianNotes.ts` (`createContactNote` around line 488: `toFriendly(lines, syncRows(friendly.mapping), …)`; `renderFriendlyNote` keeps the stored rows). Not `friendlyNoteCard` (export) and not `relationSnapshot`/mirror code.
- Test: `tests/syncContact.spec.ts`, `tests/importRemoteCard.spec.ts` (or the spec that covers `createContactNote`), `tests/friendly/noteLinks.spec.ts`

**Interfaces:**
- Consumes: `syncRows` (Task 1).

- [ ] **Step 1: Write the failing tests** (syncContact with `deps.rows = syncRows(rows with friends off)`):
  - note `friends: ['[[Piet]]']`, card and base equal otherwise and holding a different Friend line: `prepareSync` returns up to date.
  - an Apply of an `email` change: the card keeps its Friend line, the written note still has `friends: ['[[Piet]]']` (the property is not removed from the note).
  - note links on: `wantedNoteLinks` for a note whose only relation to Piet is `friends` gives no link for Piet; with `colleagues: [[Piet]]` too, Piet gets one link.
  - Import of a card with a Friend line and a Child line with friends off: the new note has `children`, no `friends`.
  - Sync all scan (`tests/syncAll.spec.ts`): a contact whose only difference is friends counts as equal.
- [ ] **Step 2: Run** the specs — FAIL where the stored rows are still used.
- [ ] **Step 3: Implement** the wiring. `grep -rn "friendly.mapping" src/sync src/contacts/obsidianNotes.ts` and decide per use: Sync/Import → `syncRows`; mirror, sidebar, graph, export → stored rows.
- [ ] **Step 4: Run** `npx vitest run` and `npm run build` — all pass.
- [ ] **Step 5: Commit** `feat(sync): Sync and Import skip properties with Sync off`

### Task 4: Turning Sync back on

**Files:**
- Modify: `src/contacts/friendly/dateLabels.ts` (`rowsForBase`, `withUnfilledDates`, `withFilledLeftOut`), `src/sync/syncContact.ts` only if the "base read without some rows" check (`baseRows.length < deps.rows.length`) needs it
- Test: `tests/friendly/dateLabels.spec.ts`, `tests/syncContact.spec.ts`

**Interfaces:**
- Produces: `rowsForBase(rows, storedAt, reader)` also leaves out every row with `syncSince` later than `storedAt ?? 0`, but by marking it `skip: true` in place (not dropping it), so its base lines are blocked and never fall through to another row (Review Focus 1). The check in `prepareSync` that the base "was read without some of the rows" (now `baseRows.length < deps.rows.length`) must also be true when `rowsForBase` skipped a row that `deps.rows` did not; give it a named helper `export function baseLeavesOut(rows: MappingRow[], storedAt: number | undefined, reader?: Reader): boolean` in dateLabels.ts and use it in both places in `prepareSync`. `withUnfilledDates` and `withFilledLeftOut` only patch for rows left out because of a labelled date or a later reader, as now; never for a row left out because of `syncSince`, and never for a row with Sync off.

- [ ] **Step 1: Write the failing tests:**
  - `rowsForBase`: a `friends` row with `syncSince: 2000` comes back with `skip: true` for `storedAt: 1000` (same length as the input), and unmarked for `storedAt: 3000` and for a row without `syncSince`; `baseLeavesOut` is true, false, false for those.
  - `withFilledLeftOut` with a base holding friends [a, b, c], note [a, b, c], row `syncSince` after `storedAt`: the result has no `friends`.
  - syncContact: base (stored at 1000) holds friends [a, b, c], card has none, note has [a, b, c], row `syncSince: 2000`: one review row `friends`, preselected Obsidian (`local`), not a conflict and not a server removal. Card [a, b, d], same base and note: a conflict on `friends`.
  - syncContact: when everything is equal after re-enable, the base is stored again (so the next Sync reads it with the row).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** Do not call `touchBases` or fill notes for this.
- [ ] **Step 4: Run** `npx vitest run` — all pass.
- [ ] **Step 5: Commit** `feat(sync): turning Sync back on for a property never preselects a removal from a note`

### Task 5: The Sync column, README, e2e

**Files:**
- Modify: `src/ui/settings/components/propertyNamesSettings.tsx`, `styles.css` (only if the column needs it), `README.md`, `tests/e2e/radicale.e2e.ts`
- Test: `tests/ui/propertyNamesSettings.spec.ts`

**Interfaces:**
- Consumes: `sync`, `syncSince` (Task 1).
- Produces: `export function withSync(rows: MappingRow[], index: number, on: boolean, now: number): MappingRow[]` (in `mapping.ts`): off → `sync: false`, `syncSince` removed; on → `sync` removed, `syncSince: now`. Fixed rows unchanged.

- [ ] **Step 1: Write the failing tests:** `withSync` both ways (and fixed rows unchanged); the table renders a first-or-last column header `Sync` with a checkbox per row, ticked when `sync !== false`, disabled for `uid`, `name`, `photo`; toggling saves through the same save path as the other edits (no confirmation dialog).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** the column (header `Sync`, checkbox `aria-label` `Sync <property>`), and a sentence under the table, exact text:
  `Sync off: the property stays in your notes, but Sync and Import no longer read it from cards or write it to them. Lines already on a card stay there; remove them yourself if you want them gone.`
- [ ] **Step 4: README:** in "Property names in the settings" add the **Sync** column to the column list (what off does, that nothing is removed, fixed rows, turning it back on shows differences in the review and preselects nothing that removes from a note, export unaffected, update every desktop because an older version ignores the setting). One sentence in "Relationships on phones": to keep a relationship such as `friends` off the cards, untick its Sync box.
- [ ] **Step 5: e2e test 27** in `tests/e2e/radicale.e2e.ts` against Radicale: friends off; a contact whose card holds a Friend line and whose note holds other friends is up to date; an Apply of an `email` change keeps the card's Friend lines; a Friend added on the card does not come into the note; turning friends back on (`syncSince` now) shows `friends` with Obsidian preselected.
- [ ] **Step 6: Run** `npx vitest run`, `npm run build`, the e2e — all pass.
- [ ] **Step 7: Commit** `feat(settings): Sync column in the property table`
