# Every part of a field visible, and "Write as" per vCard version (step 1) — design

Date: 2026-10-22. Status: direction approved in conversation ("Ja dit lijkt me beter", "Ja doe maar. Bouw maar in.");
details marked *(my call)* were settled by the designer.

Supersedes the gender-only design of the same day (this file, before its rename) and its plan (removed).

## Why

The owner asked for a `gender` property. Working that out showed a general problem: part of what is on a card never
shows in Obsidian, and the property names table does not tell the truth about what is written.

1. **Hidden parts.** `N`, `ORG`, `ADR` and `GENDER` hold several parts separated by `;`. The table maps only some
   parts (`company` is part 1 of `ORG`; the department, part 2, is nowhere). The part number itself is hidden in the
   code: the table shows `company` reading `ORG`, nothing says "only part 1". Clearing a visible part leaves the
   hidden ones on the card (`GENDER:;non-binair`, `ORG:;Sales`) with no way to see them.
2. **Hidden write rules.** The table has one "Write as" column, but on vCard 3.0 cards the plugin writes something
   else for some rows (`anniversary` → `itemN.X-ABDATE` + label; relationships → `itemN.X-ABRELATEDNAMES` + label),
   and relation rows ignore their "Write as" cell altogether.

The owner rejected hard-coding per field ("Of hardcode je shit?") and wants a solid generic solution, not one tuned to
what happens to be on their cards today ("Ik wil een solide generieke oplossing"). The rule they agreed to:
**everything on a card is visible in the note**, either as its own property or (later) in a catch-all property.
They floated scripts for splitting fields; the designer argued for settings instead and the owner agreed: vCard has
exactly one way to split a value (`;`), so splitting is defined by the format and only "which part" needs configuring.
Scripts would have to split *and* join back without error, which risks damaging cards silently.

## The three steps (only step 1 is in this design)

1. **This design.** A "Part" column in the property names table; a second write column for vCard 3.0; default rows
   for every standard part of `N`, `ORG`, `ADR` (home and work) and `GENDER` (which brings `gender`).
2. Later: adding (and probably removing) own rows in the table, for any field or part.
3. Later: a catch-all property (working name `other`) holding every card line no row maps, as raw vCard text.

Step 1 must not block steps 2 and 3 (see Migration: the "defaults seen" record exists because of step 2).

## Goals

1. The property names table (Settings → property names, `src/ui/settings/components/propertyNamesSettings.tsx`)
   becomes:

   | Name | Read from | Part | Write as (vCard 4.0) | Write as (vCard 3.0) |
   |---|---|---|---|---|
   | `mobile` | `TEL[CELL]` | | `TEL;TYPE=CELL` | |
   | `company` | `ORG` | 1 | `ORG` | |
   | `department` | `ORG` | 2 | `ORG` | |
   | `anniversary` | `ANNIVERSARY` | | `ANNIVERSARY` | `X-ABDATE` · label `Anniversary` |
   | `spouse` | `spouse` | | `RELATED;TYPE=spouse` | `X-ABRELATEDNAMES` · label `Spouse` |
   | `gender` | `GENDER, X-GENDER` | 1 | `GENDER` | `X-GENDER` |
   | `gender-identity` | `GENDER, X-GENDER` | 2 | `GENDER` | `X-GENDER` |

   - **Part**: empty means the row takes the whole value; a number means only that part, counted from 1 as a person
     reads the value. Stored as today (`ComponentRow.index`, 0-based); the table shows `index + 1`.
   - **Write as (vCard 3.0)**: empty means "same as 4.0" (shown as a placeholder).
2. Every standard part of `N`, `ORG` (first unit), `ADR` and `GENDER` has a default row, so nothing of those fields is
   hidden any more. A property without a value does not appear in a note, so contacts without these parts look the
   same as before.
3. One generic rule picks the write key: a **new** line on a card whose `VERSION` is not `4.0` uses the row's 3.0 key
   when set, else its 4.0 key. The code knows nothing about gender, departments or prefixes.
4. Existing owners get the new rows without touching their settings; "Reset to defaults" includes them.
5. A value already on a card when its row arrives ends up in the note at that contact's next Sync. It is never removed
   from the card because the note "lacks" it.

## Non-goals (this step)

- Adding or removing rows in the table (step 2), the catch-all for unmapped lines (step 3).
- `ORG` units after the first (`ORG:Acme;Sales;Backend` — `Backend` is part 3): no default row; step 2 lets the owner
  add one, step 3 shows it anyway. *(My call: one department row covers what phones and Android hold.)*
- Showing gender on the phone: Android and Samsung Contacts have no gender field (DAVx⁵ is believed to keep unknown
  properties unchanged).
- Translating values (`M` ↔ `man`): the note holds the letters as on the card (owner: "Doe maar M F").
- Value-form differences between versions (photo encoding, date forms): they stay in code and are not shown in the
  table; the columns are about which field goes on the card. *(My call.)*
- Protecting notes when the owner edits "Read from" or "Part" of an existing row: today an edited "Read from" is not
  refilled from the cards either. Step 2 brings row adding with the note-filling that "Dates with a label" already has
  (`planDateFill`/`fillNotes`); edits can follow that path then. *(My call; flagged in the table description, see UI.)*

## Anti-goals

- Any code path for one particular field (gender, department, prefix). If one needs an `if`, the design is wrong.
- An untouched line changing, or an existing line's field name changing on edit: an existing `GENDER` line on a 3.0
  card stays `GENDER`, an `X-GENDER` on a 4.0 card stays `X-GENDER`. The write keys only name *new* lines (as
  `patchDate` already does: "Existing lines keep their form").
- `VERSION` changing.
- A Sync after the update removing any part from cards (department, prefix, gender, …), or a Sync loop.
- Two lines for one structured field where there was one (see "Rows sharing a field").

## Details

### Default rows

Order in `DEFAULT_MAPPING` (new rows in bold; all are component rows, `index` is 0-based):

- `name`, **`name-prefix`** (`N`, 3), `firstname`, `middlename`, `lastname`, **`name-suffix`** (`N`, 4), `nickname`, …
- `company` (`ORG`, 0), **`department`** (`ORG`, 1), `title`, `role`,
  **`gender`** (read `GENDER, X-GENDER`, write `GENDER`, 3.0 write `X-GENDER`, 0),
  **`gender-identity`** (same read and writes, 1), `birthday`, `anniversary`,
- **`po-box`** (`HOME_ADR`, `ADR;TYPE=HOME`, 0), **`address-extra`** (same, 1), `street`, `postcode`, `city`,
  `region`, `country`,
- **`work-po-box`** (`WORK_ADR`, `ADR;TYPE=WORK`, 0), **`work-address-extra`** (same, 1), `work-street`, …

*(My call: the names.)* `address-extra` is ADR part 2, "extended address" in RFC 6350 (apartment, suite; DAVx⁵ is
believed to map Android's neighbourhood there, unverified). The owner can rename any of them in the table as today.

Read patterns and write keys of a new row equal those of the existing rows on the same field.

### Rows sharing a field

All component rows of one field must read the same lines and write the same keys, or a new card gets two lines (e.g.
`gender` writing `X-GENDER` on 3.0 and `gender-identity` writing `GENDER`). Pending new lines are keyed by the key
actually written, so rows with equal keys share one line. The defaults follow this; `validateMapping` does not enforce
it in this step *(my call; step 2, where the owner adds rows, should)*.

On a 3.0 card `X-GENDER` thus gets `M;non-binair` when both are set. Apps that write `X-GENDER` write one word
(`Male`); read as part 1 that is the whole value, so `gender` reads it as is.

### Write key per version

- `FieldRow` and `ComponentRow` get optional `writeV3?: string`. Empty or absent: same as `write`.
- Wherever a new line's name and params come from `row.write` (`addLine` in `patchField`, `patchComponent` and its
  pending lines in `newParts`, the plain branch of `patchDate`, `patchPhoto`'s fallback, `newCard` via `patch`), use
  the key for the card's version.
- `COMPONENT_COUNT` (`patch.ts`) is looked up by the name of the key actually written. `GENDER` gets no entry *(my
  call)*: like `X-GENDER` and any `X-` field it gets as many parts as the rows set (`setPart` pads), so a new line is
  `GENDER:M`, not `GENDER:M;`.
- `anniversary` keeps its behaviour; how it is stored is the builder's choice, as long as cards come out identical.
- Relation rows: unchanged behaviour. The 3.0 cell shows `X-ABRELATEDNAMES · label <labels[0]>`, or "same as 4.0"
  when the row has no label (then 3.0 gets `RELATED`, as today).
- The "Dates with a label" rows stay in their own table, unchanged.

### The table *(my calls)*

- Columns: Name, Read from, Part, Write as (vCard 4.0), Write as (vCard 3.0).
- **Part** cell: an input on component rows (a whole number ≥ 1; anything else is a validation error, nothing saved,
  as with other errors). Empty and read-only on field rows, relation rows and the anniversary row. Turning a field row
  into a part (or back) is not offered in this step: that changes the row's kind and belongs with step 2.
- **Write as (vCard 4.0)**: an input on field and component rows as today; read-only text on relation rows, showing
  what is written (`RELATED;TYPE=<types[0]>`), since `relationLines` ignores `write`.
- **Write as (vCard 3.0)**: an input on field and component rows, empty allowed, placeholder `same as 4.0`; read-only
  text on the anniversary row (`X-ABDATE · label Anniversary`) and relation rows. Making labels editable would change
  how 3.0 lines are *read* (the label is how they are recognised): a separate decision.
- The description above the table explains Part, the two write columns, and that changing "Read from" or "Part" does
  not refill notes (Sync treats the new reading as if the note had changed). Wording is the builder's; short.
- `validateMapping`: a non-empty `writeV3` gets the same check as `write`; `index` must be a whole number ≥ 0.
- `rowIdentity` (renames) stays based on `write` and `index`; `writeV3` is not part of it.

### Migration *(my call: with a record)*

`migrateMapping` (applied on load in `src/context/sharedSettingsContext.ts`) adds the new default rows to a stored
mapping. Because step 2 will let the owner remove rows, a removed row must not come back on every load: the settings
get a small record of which set of default rows the stored mapping has seen (e.g. `friendly.defaultRowsSeen: number`;
absent = 0). Rows new in set 1 (this step) are added only when the record is below 1; then it becomes 1. The existing
`ROWS_NEW_IN_PART_6` and label logic stays as it is.

*(My call, after the builder check:)* a new row copies "Read from", both write keys and the reader mark from its
stored sibling: the stored row that matches the default sibling's identity (e.g. for `po-box` the stored row with
identity `component|ADR;TYPE=HOME|2`, the default `street`), else the stored row with the sibling's default name. So
an owner who edited `street` to write `ADR;TYPE=home` gets `po-box` on the same line. Without a sibling (or for
`gender`/`gender-identity`, which have none in stored mappings) the defaults are used; `gender-identity` follows the
`gender` row just added or found.

A new row is added unless the stored mapping already has a row with the same property name, or a component row with
the same write key (name and params as written, ignoring case) and index, or (for `gender`/`gender-identity`) any row
reading `GENDER` or `X-GENDER` *(my call: an owner who mapped gender some other way keeps theirs)*. Position: right
after the stored counterpart of the default row before it (as the relation rows are placed), else at the end.

The migration is saved at startup (`initSettings` → `setSettings`), not on `reloadSettings`; that is fine since the
rows carry no timestamp.

### Existing values on cards (goal 5)

A sync base stored before the new rows existed was read without them. Read with them, the base would have e.g.
`department: Sales` while the note has none, and Sync would see "removed in Obsidian" and delete it from the card.

Decided **per sync base** *(as in the gender design, after the builder check: a shared timestamp has a multi-device
gap)*: bump the reader (`CURRENT_READER` in `src/contacts/friendly/translate.ts`) from 2 to 3; every new default row
carries a mark (e.g. `sinceReader: 3`) that survives a rename and comes back with "Reset to defaults"; a base stored
with reader < 3 is read without the marked rows. `rowsForBase` and `withUnfilledDates` (in `dateLabels.ts`; used by
`syncContact.ts` and the export path in `obsidianNotes.ts`) take the base's reader as well as its `storedAt`, so:

- Sync: the card's department/prefix/gender reads as the server's addition and comes into the note; the base is then
  stored with reader 3. The existing "re-store an up-to-date base when it was read with fewer rows" branch covers
  contacts without such values.
- Export: a value the note leaves empty for a row the base did not have is taken from the base, not removed.

A desktop still on the old version that receives the new `data.json` reads its bases with the new rows and would offer
to remove those parts. That cannot be fixed in code: the release notes and README say to update the plugin on every
desktop before syncing from it.

### File names and the rename offer *(my call, after the builder check)*

Computed note names (`contactFileName` → `createNameSlug`) already include `N` prefix and suffix. Sync's rename offer
(`renameTarget` in `src/sync/reviewExtras.ts`, called from `syncFlow.ts` with `review.base`) compares the computed name
of the base with that of the result. A base read without the new rows has no prefix, so the first Sync after the
update would offer to rename every contact with a prefix or suffix (ticked by default; with folders it moves folders
and rewrites links). That is an artefact, not a change: the rename check must compare against the base's values for
the rows it was read without, taken from the base read with all rows (as `withUnfilledDates` does for the export).
Result: no rename offer caused by parts becoming visible; a prefix changed in the note or on the phone still renames.
The sidebar name is computed from the note and follows the note as today.

### Clearing parts

`finishComponents` removes a structured line when all its parts are empty (except `N`), as today. With every standard
part visible, clearing all of them in the note empties the line, and clearing one leaves the others visible in the note.

### Convert and old notes

- Old upstream keys (`N.PREFIX`, `N.SUFFIX`, `ORG` with a unit, `ADR` parts, `GENDER`) convert into the new properties
  through the mapping like every other key (`convertFrontmatter` → `recordToFriendly`). `hasVCardValues` therefore
  counts a note with e.g. a non-empty `N.PREFIX` as not converted, so Sync asks to convert first. Test both.
  `technicalKeys` keeps treating *empty* `N.PREFIX`/`N.SUFFIX` as noise.
- A hand-written `department` (or any new property) is the owner's value and is written to the card as is.

## Testing

- Unit, patch/newCard: each new row reads and writes its part on 3.0 and 4.0; `gender` written as `GENDER` on 4.0 and
  `X-GENDER` on 3.0, with `gender-identity` on the same line; an existing line keeps its name on edit on both versions;
  `writeV3` on an arbitrary other field row works the same (proves no field-specific code); untouched lines
  byte-identical; clearing all parts removes the line (not `N`).
- Migration: rows added at the right places; not added when name, identity or a `GENDER`/`X-GENDER` reader exists;
  not added again when the record says seen (also after the owner would have removed one); running again changes
  nothing; existing relation and anniversary rows unchanged.
- Rename: a contact with `N:Jansen;Jan;;Dr;` and a reader-2 base → no rename offer at first Sync; a prefix edited
  afterwards → rename offered.
- Migration with edited siblings: `street` writing `ADR;TYPE=home` → `po-box` writes the same; a new card gets one
  `ADR` line.
- Base: a card with `ORG:Acme;Sales`, `N:…;Dr;`, `GENDER:M` whose base was stored with reader 2 → after Sync the note
  has the values and the card is unchanged; the export path likewise; a base stored with reader 3 and a note without
  them → removal offered.
- Convert: `N.PREFIX: Dr`, `GENDER: M` become `name-prefix`, `gender`.
- UI: the five columns render; editing Part and the 3.0 cell of a component row saves; invalid Part shows an error;
  relation write cells and the anniversary 3.0 cell are read-only.
- e2e against Radicale: department, prefix and gender round-trip on a 3.0 and a 4.0 card; second Sync up to date.
- README: the property names table (Part, two write columns), the new rows, the `GENDER` example in "Basic Contact
  Information" (`M`, `F`, `O`, `N`, `U`; 3.0 uses `X-GENDER`), that phones don't show gender, and "update every desktop
  before syncing".
- Owner, once on the phone: department and name prefix survive a DAVx⁵ round trip; a 3.0 card with `X-GENDER` too.
