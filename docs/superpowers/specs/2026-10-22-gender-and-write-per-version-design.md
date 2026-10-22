# Gender, and "Write as" per vCard version — design

Date: 2026-10-22. Status: direction approved in conversation ("dit is wat ik wil", on the two-column table below);
details marked *(my call)* were settled by the designer.

## Why

The owner wants a `gender` property in contact notes. vCard 4.0 has `GENDER` (RFC 6350: a sex letter `M`, `F`, `O`,
`N` or `U`, optionally `;` and free text for the identity, e.g. `GENDER:O;non-binary`). vCard 3.0 has no such field;
some apps use `X-GENDER` there. So the field the plugin writes depends on the card's version.

While working that out, the owner noticed the property names table is not honest today: it has one "Write as" column,
but on vCard 3.0 cards the plugin already writes something else for some rows, and nothing in the table shows it:

- `anniversary`: the table says `ANNIVERSARY`; on 3.0 the plugin writes `itemN.X-ABDATE` + `itemN.X-ABLabel:_$!<Anniversary>!$_`
  (`FieldRow.appleDateLabel`, `patchDate` in `src/contacts/friendly/patch.ts`).
- relationships: the table says `RELATED;TYPE=spouse`; on 3.0 the plugin writes `itemN.X-ABRELATEDNAMES` + a label
  (`RelationRow.labels[0]`, `relationLines` in `patch.ts`).

The owner explicitly does not want a gender special case hard-coded ("Of hardcode je shit?"): what gets written for
gender must be data in the mapping row, and the table must show per version what goes on the card.

## Goals

1. The property names table (Settings → property names, `src/ui/settings/components/propertyNamesSettings.tsx`) shows
   two write columns, **Write as (vCard 4.0)** and **Write as (vCard 3.0)**:

   | Name | Read from | Write as (vCard 4.0) | Write as (vCard 3.0) |
   |---|---|---|---|
   | `mobile` | `TEL[CELL]` | `TEL;TYPE=CELL` | *(empty: same as 4.0)* |
   | `anniversary` | `ANNIVERSARY` | `ANNIVERSARY` | `X-ABDATE` · label `Anniversary` |
   | `spouse` | `spouse` | `RELATED;TYPE=spouse` | `X-ABRELATEDNAMES` · label `Spouse` |
   | `gender` | `GENDER, X-GENDER` | `GENDER` | `X-GENDER` |

   For most rows the 3.0 column is empty, meaning "same as 4.0".
2. A field or component row can hold an optional 3.0 write key (proposed name `writeV3`). When a **new** line is
   written for that row on a card whose `VERSION` is not `4.0`, `writeV3` is used; otherwise `write`. This is one
   generic rule in the code; it knows nothing about gender.
3. A new default row **`gender`**: read `GENDER`, `X-GENDER`; write `GENDER`; `writeV3` `X-GENDER`.
4. Existing owners get the `gender` row without touching their settings (their mapping is stored in `data.json`; see
   Migration). "Reset to defaults" includes it.
5. A gender that is already on a card when the row arrives ends up in the note at that contact's next Sync. It is
   never removed from the card because the note "lacks" it.

## Non-goals

- Showing gender on the phone. Android and Samsung Contacts have no gender field; DAVx⁵ is believed to keep unknown
  properties on the card unchanged (vcard4android's unknown-properties row). The plugin cannot change that.
- Translating the value (`M` ↔ `man`). The owner chose the letters ("Doe maar M F").
- Changing what is written today for any existing row, on either version. The new columns only make visible what
  already happens, plus allow `writeV3` on field and component rows.
- Value-form differences between versions (photo as data URI on 4.0 vs `ENCODING=b` on 3.0, date forms). Those stay
  in code and are not shown in the table: the columns are about *which field* goes on the card. *(My call.)*

## Anti-goals

- Any gender-specific code path. If gender needs an `if`, the design is wrong.
- An untouched line changing, or a line's field name changing on edit: an existing `GENDER` line on a 3.0 card stays
  `GENDER` when its value is edited, an existing `X-GENDER` on a 4.0 card stays `X-GENDER`. `writeV3`/`write` only
  pick the name of a *new* line (the same rule `patchDate` already follows: "Existing lines keep their form").
- `VERSION` changing (global rule).
- A Sync after the update removing gender from cards, or a Sync loop.

## Details

### The `gender` row *(my call: component row)*

`GENDER` is structured (`sex;identity`). As a plain field the note would get `O;non-binary` and an edit would write it
back escaped (`O\;non-binary`), which is wrong. So `gender` is a **component row, index 0** (`ComponentRow`, like
`company` on `ORG`): the note holds the letter (`M`), and an identity text on the card stays untouched when the letter
is edited. No `gender-identity` property: offered (component index 1), the owner declined ("Laat die gender-identity
maar"). The identity text stays on the card, untouched.

The note holds the letter as on the card: `M`, `F` (the owner's choice). Values from other apps on `X-GENDER` (e.g.
`Male`) are read as they are; nothing is translated, like every other field.

When a card holds both `GENDER` and `X-GENDER`, the first line feeding the component row wins, as for every component
row in `toFriendly`.

### Write key per version

- `FieldRow` and `ComponentRow` get optional `writeV3?: string`. Empty or absent: same as `write`.
- Wherever a new line's name/params come from `row.write` (`addLine` calls in `patchField`, `patchComponent`, the
  pending component lines keyed by write key in `newParts`, `patchDate`, `newCard`), use the key for the card's version.
  Pending component lines must be keyed by the key actually written.
- `anniversary` keeps its current behaviour. In the table its 3.0 cell shows `X-ABDATE` and the label from
  `appleDateLabel` (*how* it is stored is the builder's choice: it may become `writeV3: 'X-ABDATE'` plus the existing
  `appleDateLabel`, as long as cards come out identical to today).
- Relation rows: the 3.0 cell shows `X-ABRELATEDNAMES` and `labels[0]`, or "same as 4.0" when the row has no label
  (then 3.0 gets `RELATED`, as today).
- The "Dates with a label" rows stay in their own table, unchanged (they write `X-ABDATE` on both versions).

### Editing in the table *(my call)*

- Field and component rows: the 3.0 cell is an input like the 4.0 cell (`CommitInput`), empty allowed.
- Anniversary and relation rows: the 3.0 cell is read-only text, as the relation "Read from" cell is today. Making
  labels editable here would also change how those rows are *read* (the label is how a 3.0 line is recognised); that is
  a separate decision.
- `validateMapping`: a non-empty `writeV3` must be a valid write key (same rules as `write`).
- Row identity for renames (`rowIdentity` in `mapping.ts`) stays based on `write`; `writeV3` is not part of it.

### Migration

`migrateMapping` (`mapping.ts`, applied on load in `src/context/sharedSettingsContext.ts`) adds the `gender` row once
when the stored mapping has no row writing `GENDER` and no property named `gender`; after `role` if present, else
after the last field row before the address components *(my call; position only matters for display)*. It never
re-adds a row the owner removed later — the builder picks how "already added once" is remembered (e.g. a marker in the
settings), since today `migrateMapping` only knows "rows new in Part 6".

### Existing genders on cards (goal 5)

A sync base stored before the row existed was read without it. Read with the new row, the base would have `gender: M`
and the note none, so Sync would see "removed in Obsidian" and delete it from the card.

*(My call, after the builder check:)* this is decided **per sync base, not per device or by time**. A shared `since`
timestamp (as the "Dates with a label" rows use) has a gap: a device that updates later may have stored bases after
that `since` while still reading without the row. So: bump the reader (`CURRENT_READER` in
`src/contacts/friendly/translate.ts`, today 2) to 3, and read a base stored with reader < 3 without the rows that are
new in reader 3 (the `gender` row; the builder picks how such rows are marked, e.g. a field on the row, as long as a
rename of the row keeps the mark and "Reset to defaults" brings it back). `withUnfilledDates`/`rowsForBase` (used in
`syncContact.ts` and the export path in `obsidianNotes.ts`) get the same treatment, so the card's gender comes into
the note.

A desktop still on the old version that receives the new `data.json` reads its bases with the `gender` row and would
offer to remove genders. That cannot be fixed in code: the release notes and README say to update the plugin on every
desktop before syncing from it.

### Existing gender data in notes

- An old-style `GENDER: M` key (upstream format) makes `hasVCardValues` count the note as not converted, so Sync asks
  to run "Convert contacts…" first. Convert must turn it into `gender` like every other mapped key. Test that.
- A hand-written `gender` property is the owner's value and is written to the card as is.

### Relation rows: the 4.0 cell too *(my call)*

`relationLines` ignores `row.write` and always writes `RELATED;TYPE=<types[0]>`, yet the 4.0 cell is an input today.
Same honesty problem: the 4.0 cell of relation rows becomes read-only text showing what is written.

### Validation

`validateMapping` only requires a non-empty `write` today. A non-empty `writeV3` gets the same check as `write` (no
stricter rules).

### Migration notes from the builder check

- The migration is saved at startup (`initSettings` → `setSettings`), not on `reloadSettings`. Fine for the row
  itself, since it carries no timestamp in this design.
- The settings UI cannot remove rows, so "never re-add a removed row" only guards hand-edited `data.json`; still do it.

## Testing

- Unit: new `gender` line written as `GENDER` on 4.0 and `X-GENDER` on 3.0 (patch and `newCard`); an existing line
  keeps its name on edit, on both versions; identity text kept when the letter changes; reading both names; a card with
  both; untouched lines byte-identical; `writeV3` on an arbitrary other field row works the same (proves no gender code).
- Migration: the row is added once, not when `gender` or a `GENDER` writer exists, not again after removal; anniversary
  and relation rows unchanged.
- Base: a card with `GENDER:M` whose base was stored with reader 2 → after Sync the note has `gender: M` and the card
  is unchanged; the export path likewise. A base stored with reader 3 and a note without gender → removal offered.
- Convert: a note with `GENDER: M` becomes `gender: M`.
- UI: the four columns render; editing the 3.0 cell of a field row saves; anniversary 3.0 cell and both relation
  write cells read-only.
- e2e against Radicale: gender round-trips on a 3.0 and a 4.0 card; second Sync up to date.
- README: the property names table description (two write columns), the gender row; fix the `GENDER` example in
  "Basic Contact Information" (`M`, `F`, `O`, `N`, `U`; 3.0 uses `X-GENDER`); a note that phones don't show gender.
- Owner, once on the phone: a 3.0 card with `X-GENDER` survives a DAVx⁵ round trip.
