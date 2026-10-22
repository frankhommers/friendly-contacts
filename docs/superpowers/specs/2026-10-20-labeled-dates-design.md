# Dates with a label — design

Date: 2026-10-20. Status: design for review.

## Why

A phone can store a date with any label on a contact. The owner has a date "Verkering" (when they started dating)
on a person in Android Contacts. DAVx5 puts such a date on the card as

```
item3.X-ABDATE:2012-05-01
item3.X-ABLabel:Verkering
```

Apple Contacts writes the same form. The plugin reads `X-ABDATE` only when the label is `Anniversary` (the
`anniversary` row, Part 6). Any other labelled date stays on the card untouched (Sync is lossless), but it never
shows in Obsidian, and Obsidian cannot add one.

The owner wants these dates in the note, kept "friendly": a plain date property with an **English** name, for example
`dating: 2012-05-01`, while the phone keeps showing the label "Verkering". The plugin cannot translate a label
reliably, so the owner names the property.

## Goals

1. A labelled date on a card shows in the note as a date property, once its label has a property in the settings.
2. A date filled in in the note goes to the card with its label, so the phone shows it under that label.
3. One place to manage this: a table **Dates with a label** in the settings. Each row: the label on the card and the
   property in the note.
4. The table shows labels that are on the cards but have no row yet ("Verkering — on 2 contacts"), each with an
   **Add** button. Add creates the row with a suggested property name that the owner changes into English.
5. New labels the owner makes up in Obsidian are also added in this table (label + property). There is no other place.

## Non-goals

- Translating labels, or suggesting English names beyond a mechanical suggestion (lower-case, spaces to `-`).
- Adding or editing these dates from the sidebar (can come later).
- Dates without a label (Android "Other" without a text, written as `X-ABDATE` without `X-ABLabel`): they stay on
  the card as now.
- Clickable relationships on Android: Android stores only a name and a type for a relationship, so there is nothing
  to link to (see the conversation of 2026-10-20). Not part of this work.

## Anti-goals (a failure even if it works)

- A date on a card disappears or changes because of this feature. In particular: **adding a row must never make
  Sync remove that date from cards** because the notes do not have the property yet. (Today a base is read with the
  current mapping; a newly mapped date would be in the base and on the server but not in the note, which reads as
  "removed in Obsidian".)
- Dutch (or any phone-language) keys forced into the frontmatter.
- A card's `VERSION` changes, or untouched lines change (existing global rule).

## On the card

- Read: an `X-ABDATE` line whose group's `X-ABLabel` matches a row's label (trimmed, ignoring case; Apple's
  `_$!<…>!$_` wrapping removed, as `labelText` does today) fills that row's property.
- Write: a new date is written as `itemN.X-ABDATE:<date>` + `itemN.X-ABLabel:<label>` — in **both** vCard 3.0 and
  4.0, because that is what DAVx5 and Apple write for custom dates (4.0 has no labelled date of its own). The label is
  written as the row has it (plain text, not Apple's `_$!<…>!$_` form, which only exists for built-in labels).
- Change and removal: the existing line (and its label, on removal) is changed or removed in place, like the other
  labelled lines (`X-ABRELATEDNAMES`, the anniversary).
- Dates without a year follow the existing rules for birthday and anniversary (`dates.ts`: Apple's year 1604 +
  `X-APPLE-OMIT-YEAR`, the `--MMDD` forms, the note's year-less form).
- The `anniversary` row keeps its behaviour (4.0: `ANNIVERSARY`, 3.0: `X-ABDATE` + `_$!<Anniversary>!$_`). It is
  shown in the new table as a fixed first row, so the owner sees all dates in one place.

## In the note

- The property holds a date in the note's usual date form (as `birthday`), so Obsidian shows a date picker.
- Several dates with the same label on one card: the first in `<property>`, the next in `<property>-2`, and so on, as
  the other repeated properties (`phone-2`) do. *(My call.)*
- The review screen shows these rows like any other date row.

## The settings table

- Lives in the settings next to the other property names (Property names section), as its own group
  "Dates with a label".
- Columns: label on the card, property in the note, remove.
- The property name is validated like other property names (unique, not a fixed or reserved name).
- Renaming a property renames it in the notes, with the same confirmation and blocking rules as renaming any other
  property today.
- The label of a row cannot be edited. To change it, remove the row and add a new one. *(My call: editing a label
  would either leave the notes' values to be pushed as new dates under the new label, or require relabelling cards.)*
- Removing a row never touches cards: the dates stay on the cards and stop showing. The property **is removed from
  the notes**, after a confirmation that says how many notes change, with the same blocking rules as a rename. So a
  row added again later starts clean and never pushes leftover values as new dates. *(My call.)*
- **Reset to defaults** restores the default property names but keeps the rows of this table (they are the owner's
  own labels, not defaults). *(My call.)*
- **Labels found on the cards**: a button reads the cards of the address books (like "Count card versions" does for
  versions) and lists every `X-ABDATE` label without a row, with the number of contacts, and an **Add** button each.
  Built-in Apple labels other than Anniversary (`_$!<Other>!$_`) are listed by their readable name.

## Left to the builder

- How rows are stored: as mapping rows (a `field` row with `format: 'date'`, an `appleDateLabel`, and no plain-vCard
  read pattern fits the existing code) or as their own list. Whatever is chosen, the existing machinery for renames,
  validation, `migrateMapping` and the review screen should keep working.
- How the anti-goal on adding a row is met. One way: when a row is added, fill the property in the notes of contacts
  whose stored base holds the date (as a rename touches notes), so base, card and note agree. Another: remember per
  base which labels were mapped when it was stored, as `reader` does for code changes.
- Where the scan for labels gets its cards (server listing per address book, or the stored bases plus the server).
- Layout and wording of the table, within the style of the existing settings.

## Testing

- Unit: reading and writing per version (3.0 and 4.0), year-less dates, label matching (case, Apple wrapping), two
  dates with one label, removal removes the label line too, untouched lines byte-identical.
- The anti-goal: a card with a "Verkering" date, synced before the row existed; add the row; the next Sync never
  removes the date from the card and the note gets it.
- e2e against Radicale: a DAVx5-shaped card with a custom date round-trips; a date added in Obsidian lands as
  `X-ABDATE` + `X-ABLabel`.
- README: what the table does, the English-name advice, Android "Other" dates without a label are not shown.
