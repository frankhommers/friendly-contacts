# Sync per property: a Sync checkbox in the property table

Date: 2026-10-25. Status: approved by the owner ("Kun je bouwen?").

## Why

`friends` lists grow long. Today every relationship row is written to every card (`X-ABRELATEDNAMES` with label
*Friend* on 3.0, `RELATED;TYPE=friend` on 4.0), so cards on the phone get long and Sync all shows noise for every
friend added or removed. The owner wants friends to live in Obsidian only.

The owner dislikes hard-coding and wants a generic switch, not a special case for `friends`. The same need may come
up for `met`, `acquaintances` or any other property.

## What the owner decided

- A column **Sync** in the property table (Settings → Property names), a checkbox per row, ticked by default. The
  name echoes `sync: false` in a note: that turns Sync off for one contact, this for one property.
- **Turning Sync off for a row never removes anything from a card.** The plugin stops reading that property from
  cards and stops writing it to cards. Lines already on a card stay there, untouched.
- **Cleaning up the cards is the owner's own job.** No command, button or bulk action for it.
- The property stays in the notes, unchanged.

## Behaviour with Sync off for a row

- **Reading:** the row's card lines are not mapped. They count as lines the plugin does not know, which already stay
  on the card untouched (like a relationship with an unknown label today). A friend added on the phone stays on the
  card and does not come into the note.
- **Writing:** the note's value for that property is never written to a card, also not on a new card and not on a
  card moved to another address book. An Apply that writes other properties leaves the row's lines as they are.
- **Review and Sync all:** the property never shows as a review row, so a contact whose only difference is that
  property is up to date. No Import button in the review for people reached only through that property.
- **Import from the address book** (Import panel, Import all, ghost click in the graph): does not fill the property
  from the card.
- **Not affected:** the note itself, the sidebar's relationship lines and + Relationship, mirroring between notes
  (**Mirror relationships on this device**), the people graph, Tidy relationship links, link rewriting after moves.
  These all work on notes only.

## My calls (the owner can override)

1. **Every row has the checkbox**, fields and parts too, not only relationships. Exception: the fixed rows `uid`,
   `name` and `photo` are always synced; their checkbox is shown ticked and disabled. `uid` and `name` identify the
   contact and give the card its name; `photo` has its own repair paths (damaged Radicale photos) that change PHOTO
   lines regardless of the rows, so it cannot honour "never touch the row's lines".
2. **No confirmation when unticking**, because unticking removes nothing. A short description under the table says
   what Sync off does.
3. **Parts of one field** (`company`/`department` in `ORG`, the parts of `N` and `ADR`, `gender`/`gender-identity`)
   may differ in their Sync setting. With a part off, the part on the card is kept as it is when the line is written
   for the other parts; a new line leaves that part empty. With every part of a field off, the line is not read or
   written at all.
4. **Links to Obsidian notes on cards** follow the Sync setting: a person reached only through rows with Sync off
   gets no `obsidian://` link. A link already on a card for such a person is removed at the next Apply, as today when
   a relationship goes away. (The link is the plugin's own line, not the property.)
5. **Legacy rewrite:** old relationship lines (`urn:uuid:`) of a row with Sync off are not rewritten either. They
   are the row's lines, so they stay untouched.
6. **Turning Sync back on never takes anything out of a note without the owner choosing it.** The sync base may
   still hold the row's lines from before (the owner may have cleaned the card since). So the row gets the time it
   was turned on, in its own field (not the labelled dates' `since`, which keeps its meaning), and a base stored
   before then is read without the row. Unlike a labelled date added later: **no touching of the bases, no filling of
   notes from bases, and no `withFilledLeftOut` for that row** (each of those would read the stale base with the row
   again, so a cleaned card would look like a removal on the server, preselected, and Apply all would strip notes).
   Result, with the base not knowing the row: a value only in the note is an Obsidian change (written to the card
   after review), a value only on the card is a server change (into the note after review), and different values on
   both sides are a conflict. A list relation such as `friends` is compared as one value, as everywhere in the review
   today: note [a, b, c] against card [a, b, d] is one conflict on `friends`, which Apply all skips and the owner
   decides. No per-item merge.
7. **A line of a row with Sync off is skipped, not passed on.** It does not fall through to another row whose
   pattern also matches (a 4.0 `RELATED;TYPE=friend,colleague`, or an overlapping custom pattern): such a line is not
   mapped at all, so no other row edits or removes it.
8. **The legacy relationship rewrite on 4.0 cards** (`legacyFix`) currently rewrites lines without looking at the
   rows; it must skip the lines of a row with Sync off (point 5).
9. **Other desktops:** the setting is stored in data.json with the property table, so it travels with the vault
   settings. An older plugin version ignores it and syncs the property as before. The README says to update every
   desktop.

10. **Export to .vcf is not affected.** The checkbox is called Sync and only governs Sync with the server and Import
   from it. Exporting or sharing a note as a vCard file writes every property as before.

## Non-goals

- Removing the property's lines from cards, in any form.
- Per-contact or per-address-book Sync settings for a property (per contact there is already `sync: false` for the
  whole note).
- Changing how friends are stored in notes, friend groups, or backlinks instead of mirroring.

## Anti-goals

- Unticking a box changes a card or a note. It must not.
- Turning a box back on offers to remove values from notes.
- A hidden special case for `friends`; the checkbox is the only way in.

## Where it touches the code (for the builder, not binding)

- `src/contacts/friendly/mapping.ts`: the row types get an optional flag (absent = synced); `validateMapping` keeps
  checking rows with Sync off (names must stay unique).
- The place the sync takes its rows (`syncContact.ts`, `translate.ts`, `rowsForBase` in `dateLabels.ts`, import,
  `noteLinks.ts`): filter out rows with Sync off before reading and writing, so their lines fall into the existing
  "unknown line, keep it" path.
- `src/ui/settings/components/propertyNamesSettings.tsx`: the column, the description, `since` when a row is turned
  back on, touching the bases.
- README: the column in "Property names in the settings", and a sentence in "Sync" and "Relationships on phones".
- Tests: unit tests for read/write/patch with a row off (a 3.0 and a 4.0 card, a part off), re-enable with a stale
  base, links; e2e against Radicale: friends off, a friend added on the card stays on the card and stays out of the
  note, an Apply of another property keeps the friend lines.
