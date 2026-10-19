# Address book sources, Sync with a review screen, a folder per contact, dates and the people graph

Status: approved 2026-10-18 (Parts 1-3); Parts 0, 4 and 5 added on the owner's request the same day. Builds on `2026-10-17-friendly-properties-design.md` (branch `feature/friendly-properties`).
Decisions marked *(builder's call)* were made while writing this, not by the owner; they can be challenged.

## Why

Friendly Contacts syncs one note with one card in one Radicale address book. Three things are missing for the owner:

1. **Several address books.** The family shares contacts per address book (a private book and a shared family book on the
   same Radicale; other people may use Nextcloud or iCloud). Today only one address book can be configured.
2. **Seeing what Sync will do before it happens.** Today a conflict silently keeps the server value and appends a
   `> [!warning] Sync conflict` callout to the note; without a sync base the server always wins. The owner wants Sync to be
   a deliberate act per person: press Sync, see the differences side by side, decide, apply.
3. **A place for everything about a person.** Sinterklaas poems, speeches, photos of a dinner: the owner wants these next to
   the contact, in a folder per person, with the contact note as that folder's folder note. The owner already uses the
   Folder Notes plugin (LostPaul), but this must be configurable for anyone, with or without that plugin.
4. **Birthdays without a year** look broken: `--0315` shows as `--0315`, and an iPhone card (`1604-03-15` with
   `X-APPLE-OMIT-YEAR=1604`) shows a person of 422 years. The sidebar's birthday sort fails on the first form.
5. **Seeing relationships.** They live in properties only; the sidebar does not show them, and Obsidian's graph shows that
   two people are linked but not how. The owner wants a people graph inspired by Nametag (nametag.one).

Relationships (`RELATED` <-> `[[links]]`, two-way mirroring) must keep working through all of this.

## Goals

- Several **sources** (CardDAV address books), each with its own URL and credentials; every contact note belongs to
  exactly one source.
- **Sync per contact opens a review screen** whenever the note and the card differ: per property the Radicale value, the
  Obsidian value and the result; the user decides, then applies. Nothing is written before Apply.
- **Import one contact from the server**: pick a card that has no note yet, from any source.
- Optional **folder per contact** layout, whose folder note naming and placement cover the common folder note conventions,
  with a one-click copy of the Folder Notes plugin's settings.
- Relationships stay first-class: shown as names in the review screen, mirrored between notes as today, resolved across
  sources, visible and editable in the sidebar, and drawn in a people graph.
- Dates without a year (and partial dates) shown in one readable form and written back in the form the card used.

## Non-goals

- One person in several sources at once (merging cards from two address books into one note).
- Automatic or background sync. Sync stays a user action per contact. The existing "Contacts available for import"
  insight and its "Import All" stay as they are (now across all sources).
- Mobile sync (unchanged: the HTTP client is Node-only).
- Syncing the note body or anything else in a contact's folder.
- Live-following another plugin's settings (see "Folder per contact").

## Anti-goals

- Anything written to the note or the server before the user pressed Apply.
- A card written to the wrong address book, or a second copy of a card created because the note's source was unclear.
- A folder, or any file in it other than the contact note, being deleted, renamed away from its person, or synced.
- Losing relationships: a relation that silently disappears, points at the wrong person, or stops mirroring.
- The review screen as a wall of noise: unchanged properties, technical vCard fields or image data shown as text.

## Part 0: Dates without a year

Applies to every mapping row with `format: 'date'` (by default `birthday` and `anniversary`).

### Reading (card -> note)

| Card value | Note |
|---|---|
| `19800315`, `1980-03-15` | `1980-03-15` (as today) |
| `--0315`, `--03-15` | `--03-15` |
| `1604-03-15` with param `X-APPLE-OMIT-YEAR=1604` (the param's year equals the value's year) | `--03-15` |
| `1985`, `1985-04`, `---15`, date-times, `VALUE=text` values (`circa 1950`) | verbatim, as today |

### Writing (note -> card)

Only when the friendly value changed (unchanged lines stay byte-identical, as today).

- `--03-15` (also accept `--0315` typed by hand):
  - line has `X-APPLE-OMIT-YEAR`, or the card is version 3.0 -> `1604-03-15` with `X-APPLE-OMIT-YEAR=1604` (keep an
    existing param year);
  - version 4.0 -> `--0315`.
- A full date on a line that had `X-APPLE-OMIT-YEAR` drops that param.
- A full date keeps the line's existing style (basic `19800315` or extended `1980-03-15`) *(builder's call)*; a new line
  uses extended for 3.0 and basic for 4.0.
- Anything else is written verbatim; on a 4.0 card a value that is not a date gets `VALUE=text` *(builder's call)*.

### Elsewhere

- Three-way merge and the review screen compare the note form, so `--0315` and the Apple form are equal.
- The sidebar's birthday sort handles `--MM-DD`; values without a month and day (year only, text) sort last.
- The legacy (non-friendly) parser normalises the same way if it is still on an import path.
- Obsidian's "Date" property type rejects `--03-15`; the README says to keep date properties as Text.

## Part 1: Sources

### Settings

- `CardDAV` (single address book) becomes a list `sources: Source[]`:

  ```ts
  interface Source {
    id: string;          // stable, generated once (never shown, never changes)
    name: string;        // shown to the user and written in notes, e.g. "Private", "Family"
    addressBookUrl: string;
    authType: AuthType;
    authKey: string;
  }
  ```

  plus `defaultSource: string` (a source id) for new contacts.
- Migration on load: an existing `CardDAV` block with a URL becomes one source named after the last path segment of the
  URL (`.../frank/contacts/` -> `contacts`) *(builder's call)*, made the default. Old keys are removed after migration.
- The settings screen lists the sources; each source has the same credentials UX as today (locked while sync is enabled,
  "Connected as frank", masked saved secret, clear button inside the field). Add / remove / rename a source.
- Source names are unique (case-insensitive) and non-empty.
- Removing a source with notes still pointing at it: refuse, and say how many notes use it.
- Renaming a source rewrites `source:` in every note that has the old name, like a property rename (refuse and list notes
  if any write fails; see "Fixes carried over").

### Which source a note belongs to

- Property `source: <source name>`, visible in the note. It is a fixed name (like `uid`), never sent to the card, not part
  of the mapping table, not renameable.
- A note without `source` belongs to the source that holds a sync base for its UID; if none does, to the default source.
  The first Apply writes `source:` into the note, so this only matters once.
- `source:` naming a source that does not exist: Sync refuses with a Notice ("Unknown address book 'X'"). Never fall back.
- **Before anything is created, every source is searched for the UID** *(builder's call)*. Bases are per device, so a
  note edited on another device, or an old note without `source:` after the default changed, can point at a source that
  does not hold its card:
  - card found in the note's source: normal Sync;
  - not there, found in exactly one other source: the note has no `source:` -> it belongs to that source; the note
    names a source -> the review screen shows it as a move ("Address book: Private -> Family");
  - found in more than one other source: refuse, and name the sources;
  - found nowhere: "New card in <source>".
- The default source cannot be removed; make another source the default first.

### Sync state

- Sync bases are kept per source: `<plugin dir>/sync-state/<source id>/` (same files as today).
- Migration: the existing `sync-state/` contents move into the migrated source's directory.
- Bases of two sources never mix: a UID present in two sources has two independent bases.

### Changing a note's source (moving a card between address books)

- The user changes `source:` in the note and presses Sync. The review screen shows a line "Address book: Private ->
  Family" above the property rows.
- Apply: create the card in the new source (`If-None-Match: *`), then delete it from the old one (`If-Match` with the
  old card's ETag), then move the base. The card written to the new source is the reviewed result.
- The new source already has a card with this UID: refuse before anything is written; the user resolves it by hand.
- Delete from the old source fails (412 or error): the card now exists in both; the note keeps the new source and a
  Notice says the old copy is still in the old address book. Never retry the delete blindly.

### Relationships across sources

- `RELATED` points at a UID, so links resolve across sources: a note in "Family" can have `children: [[Sem]]` while Sem
  lives in "Private".
- The relation context's remote list (used to name contacts that have no note yet) covers all sources. A UID found in
  more than one source with different names counts as ambiguous, like duplicate names today.
- People who read only the family book in another app will see a `RELATED` UID they cannot resolve. Accepted.

### Import

- **Import contact from server…** (command, and a button in the sidebar): a fuzzy search list of every card, in every
  source, that has no note yet. Each item shows the name, the source and the organisation if any. Choosing one imports
  it (writing `source:`) and stores its base. *(builder's call)* One pick per open; the list can be reopened.
- A UID that already has a note (in any source) is not offered. If the same UID is in two sources and neither has a note,
  both entries are offered; after one is imported the other disappears.
- The background "Contacts available for import" insight keeps working, now over all sources.

## Part 2: Sync with a review screen

### When it opens

Sync (sidebar button, context menu, and a new command "Sync this contact" for the active note):

1. Read the note (local L), the base B for (source, UID) if any, and fetch the server card S with its ETag.
2. Compute the friendly properties of S and B and compare with L, exactly as `mergeFriendly` does today.
3. No differences (the merged result equals both L and F(S), no source change): Notice "Up to date". If there was no
   base, store S as the base now. A file name that differs from the computed name (renamed by hand, old notes) is not a
   difference and never opens the screen.
4. Otherwise open the review screen.

The card not existing on the server (new contact) also opens the screen: every row comes from Obsidian, the title says
"New card in <source>".

### What it shows

One row per friendly property where L and F(S) differ (unchanged properties are hidden; a "Show all" toggle shows them
greyed out *(builder's call)*). Each row:

| Property | Radicale | Obsidian | Result |
|---|---|---|---|
| mobile | 06-111 | 06-222 | (choice) |

- **Preselection** from the base:
  - only the server changed since the base -> Radicale;
  - only the note changed -> Obsidian;
  - both changed, or no base -> **no preselection**: the row is marked as a conflict and must be decided.
- Per row the user picks Radicale or Obsidian; text values can also be edited into a custom result. Absent values show
  as "(none)"; choosing that side removes the property.
- Buttons "All from Radicale" / "All from Obsidian" set every row (including preselected ones).
- **Apply** is disabled until every conflict row is decided. **Cancel** writes nothing, not even a base.
- Photos are shown as thumbnails, never as base64 text.
- Lists (relationships such as `children`, multi-value fields) are compared and chosen as a whole list
  *(builder's call)*; the row shows which items are only on one side.
- Relationship values are shown as names (the link text), never as UIDs. A relationship target that exists only on the
  server (no note yet) shows its name with an **Import** button that imports that person first; the row then refers to
  the new note.
- If the chosen result changes relationships, a short "Also changes" section lists the mirror writes the result will
  trigger on other notes ("Sem: parents gets [[Jan]]"). These are local note changes made by the existing mirroring after
  Apply; the other person's card reaches Radicale when that person is synced.
- If the computed file name of the result (`contactFileName` from N parts, else FN) differs from the note's current
  file name and from the computed file name of the base (without a base: of the note's own values before Sync)
  *(builder's call)*, a checkbox "Rename note to <new name>" (in folder layout: "Rename folder and note") is shown,
  checked by default. So a name changed since the last Sync on either side offers the rename; a note renamed by hand
  whose name values did not change is left alone; a declined rename is not offered again (the base then holds the
  new name). A target that already exists: checkbox disabled with the reason.
- A source change shows the line described in Part 1.

### Apply

1. Build the result props R from the choices.
2. Check nothing moved underneath: re-read the note; if its mapped properties or `source` differ from L, abort with a
   Notice and reopen the screen with fresh data.
3. Card: `patch(S, F(S), R)`. If it differs from S, PUT with `If-Match: <ETag of S>` (or create / move as above).
   412 -> Notice "changed on the server meanwhile", reopen the screen with fresh data. No ETag -> refuse (as today).
4. Note: write R (only changed properties, as `writeNote` does today), write `source:`, rename if checked.
5. Store the new base under (source, UID).

Order 3 then 4 keeps today's rule that the note takes the card's canonical form after a successful write.

### What goes away

- The conflict callout (`renderConflictCallout` and its use). Existing callouts in notes are left alone.
- "No base: server wins": without a base every difference is a decision for the user. Because the user decides, a PUT
  without a base is allowed (still with `If-Match`).
- This also resolves the open issue that a local photo could be lost on the first sync: the user sees both photos.

## Part 3: Folder per contact

### Settings

- **Contact layout**: *One note per contact* (default, today's behaviour) / *Folder per contact*.
- **Folder note name**: a pattern, default `{{name}}`, where `{{name}}` is the contact's file name (the same name a note
  gets today). A fixed name such as `index` or `README` is allowed. Must produce a valid file name; `.md` is implied.
- **Folder note location**: *Inside the folder* (default) / *Next to the folder*.
  - Inside, pattern `{{name}}`: `Contacts/Jan de Vries/Jan de Vries.md`
  - Inside, pattern `index`: `Contacts/Jan de Vries/index.md`
  - Next to: `Contacts/Jan de Vries.md` + folder `Contacts/Jan de Vries/`
  ("Next to" with a fixed name is refused: every contact would get the same file name.)
- **Copy from Folder Notes** button, shown only when the Folder Notes plugin is enabled. It reads its settings once
  (`app.plugins.getPlugin('folder-notes').settings`): `folderNoteName` (`{{folder_name}}` becomes `{{name}}`) and
  `storageLocation` (`insideFolder` -> inside, `parentFolder` -> next to). `vaultFolder`, or a `folderNoteType` other than
  `.md`, is reported as not supported and nothing is copied. Reading is defensive: missing or odd values -> a Notice,
  nothing changes.
- When Folder Notes is enabled and its settings differ from ours, the settings screen shows a warning line next to the
  button. Checked when the settings screen opens, never at runtime *(owner's choice to keep Friendly Contacts
  independent of Folder Notes internals)*.
- A fixed folder note name shows a hint: Obsidian's graph and tabs will show every contact by that name; the people graph
  (Part 5) is not affected.

### Behaviour

- A contact's **folder** is derived from its note path and the layout settings; it is not stored.
- Which notes are contacts does not change: a note with contact frontmatter. Other files in a contact's folder (poems,
  photos, notes without contact frontmatter) are never read as contacts, synced, mirrored, renamed or deleted by
  Friendly Contacts. A second contact note inside someone's folder is still a separate contact.
- **New contacts** (Import, sidebar "create", Import button in the review screen) are created in the layout: folder and
  note. Existing folder with that name: use it if it holds no contact note; if it holds one, the existing Replace/Skip
  dialog (`FileExistsModal`) decides, as for a single note today *(builder's call)*.
- **Renaming** (the review screen checkbox; also used by the layout commands) is idempotent, step by step:
  rename the folder if it is not yet at the target, then re-resolve the note and rename it only if it is not yet at its
  target. This works whether or not Folder Notes also renames (its `syncFolderName`). Targets that already exist are
  skipped and reported, never overwritten. All renames go through `app.fileManager.renameFile` (links update).
- **Layout commands**:
  - "Put each contact in its own folder": for every contact note in one-note layout, create the folder and move the note.
  - "Take contacts out of their folders": move the note out; delete the folder only when it is then empty. A folder with
    other files keeps them and is left in place; the result lists those folders.
  - Both report what moved and what was skipped; neither touches files other than contact notes and empty folders.
  - Switching the layout setting offers the matching command ("Put 232 contacts in their own folder?").
- **Move contacts to folder…** (existing) moves whole contact folders in folder layout.
- **Deleting** a contact on the server never deletes the note or its folder (unchanged).

### Links

- Links to contacts are produced by Obsidian (`fileToLinktext`), as today. With a fixed note name (`index`) the link
  text becomes a path (`[[Contacts/Jan de Vries/index]]`); relationship links then get the contact name as alias
  (`[[Contacts/Jan de Vries/index|Jan de Vries]]`) so properties stay readable. Comparison already ignores aliases.
- A contact without a note yet (server only) is written as `[[<its name>]]`. With a fixed note name that link does not
  resolve to the note once it is imported, so mirroring would miss it. Therefore, after an import in a fixed-name layout,
  relationship links in other contact notes that do not resolve and whose remote-name resolution gives the imported
  UID are rewritten to the new note's link; mirroring then runs as for any change *(builder's call)*. Only
  relationship properties of contact notes are touched. With `{{name}}` the link resolves by itself.

## Part 4: Relationships in the sidebar

- The contact view in the sidebar gets a **Relationships** section: one line per relation property that has entries
  (property name as label, e.g. "children"), the people as names.
  - A name with a note: click opens it.
  - A name without a note: grey; if the server has that person (any source), an **Import** button imports them.
  - A **×** per name removes that relationship (after a confirm *(builder's call)*); mirroring removes the other side.
- **+ Relationship** (in the section, and command "Add relationship…" for the active contact note): pick a person (fuzzy
  list of contact notes), then the kind (the relation properties of the mapping table). The link is added through
  `processFrontMatter` with Obsidian's link text; the existing mirroring adds the other side.
- Adding a relationship that already exists is a no-op with a Notice. Nothing reaches Radicale until that contact is
  synced (unchanged rule).

## Part 5: People graph

A view of people and how they relate, inspired by Nametag's network graph (idea only: Nametag is AGPL, this plugin is
MIT; no code is taken).

### Opening

- Command "Open people graph" and a ribbon icon: centred on **me**; setting "This is me" picks a contact note (stored as
  its UID). Not set: centred on the active contact, else the whole graph.
- Command "Open people graph for this contact" and a button in the sidebar contact view: centred on that contact.
- A normal Obsidian view (tab or sidebar), works on mobile too (no network access needed).

### What it shows

- **Nodes**: contact notes, with photo or initials and the name. People only linked to (no note yet) are dashed, with
  the link's name; clicking one offers Import if the server has them.
- **Edges**: from relation properties. A mirrored pair (`children` / `parents`, `spouse` / `spouse`) is one edge. An
  edge is coloured by kind and labelled with it (from the viewing person's side, e.g. "child"):
  - partner (`spouse` vCard type), family (`child`, `parent`, `sibling`, `kin`), friends (`friend`), work
    (`colleague`, `co-worker`), other (all remaining relation types).
  - The kind comes from the mapping row's vCard type, so a renamed property keeps its colour.
- **Depth**: steps away from the centre, default 2, adjustable (1-4, or everyone). Max 500 nodes; beyond that a
  message asks to lower the depth.
- **Filter pills** per kind (show / hide).
- **Level of detail** like Nametag: dots when zoomed out, names at mid zoom, photos when close.

### Interaction

- Click a node: it becomes the centre; double-click or a modifier-click opens the note.
- Drag nodes, scroll to zoom, drag the background to pan, a recenter button.
- The graph updates when contact notes change (debounced).

### Building

- d3-force simulation rendered on a canvas (d3 is ISC/BSD-licensed).
- Pure, unit-tested graph building: snapshots -> nodes and edges (mirror dedupe, kinds, depth limit, dangling links).

## Fixes carried over from the previous branch

- **Property rename with a note that already holds the new name**: refuse the whole rename and list those notes,
  instead of skipping them (a skipped note could later push its stray value). The same rule applies to renaming a source.
- **Local photo lost without a base**: resolved by the review screen (Part 2).

## Order of work

0. Dates without a year.
1. Sources (settings, migration, `source:`, per-source sync state, import list, moving between sources).
2. Review screen (replaces the conflict callout and "server wins"), Import contact, Sync this contact.
3. Folder per contact.
4. Relationships in the sidebar.
5. People graph.

Each part is shippable on its own and keeps all existing tests passing.

## Testing

- Unit:
  - settings migration (single CardDAV -> one source; sync-state move);
  - source resolution for a note (explicit, from base, default, unknown name);
  - preselection rules and the "no base" case;
  - building R from choices, including custom text, removal and whole-list choices;
  - the Apply staleness checks (note changed, 412);
  - moving between sources (create, delete, delete fails, target exists);
  - folder layout path planning (inside / next to / fixed name), idempotent rename with and without a pre-renamed folder;
  - the layout commands, including folders with other files;
  - date reading and writing per row of the Part 0 tables, both card versions;
  - adding and removing a relationship from the sidebar (mirroring follows);
  - graph building (mirror dedupe, kinds from vCard types, depth, dangling links, node cap).
- e2e against Radicale 3.8.3 (`npm run test:e2e`): two address books on one server; import from both; Sync with a
  conflict resolved each way; moving a card between books; untouched lines byte-identical as today.
- Owner's manual checklist in `tests/scripts/radicale-e2e.md` extended with the review screen, Import, layout
  commands and Copy from Folder Notes.

## Left to the builder

- Review screen layout and styling (an Obsidian `Modal`), the Notice wording.
- How the sidebar shows a contact's source.
- The settings widgets for the source list.
- Whether "Sync this contact" also appears in the file menu.
- People graph colours (from the theme where possible), node sizes, force parameters, exact zoom thresholds.

## Part 6: Card versions, and relationships phones understand

Added 2026-10-19 on the owner's request after testing alpha.6 with DAVx5 (Android) against Radicale.

### Why

- vCard 3.0 has no `RELATED`. Apple and DAVx5 (and others that copied them) store relationships in 3.0 cards as
  `itemN.X-ABRELATEDNAMES:<name>` with `itemN.X-ABLabel:_$!<Spouse>!$_` (built-in labels) or a plain label text.
  DAVx5 writes this for every 3.0 card and reads both `RELATED` and `X-ABRELATEDNAMES`; Android shows a `RELATED`
  URI (`urn:uuid:…`) as the person's name.
- The plugin writes `RELATED;TYPE=x:urn:uuid:<uid>` in every card: invisible or shown as a code on phones, and
  relationships entered on a phone are not read.
- 3.0 has no `ANNIVERSARY` either; Apple and DAVx5 use `itemN.X-ABDATE` with label `_$!<Anniversary>!$_`.

### Goals

- Every card keeps its own version; each property is written in the form that version uses.
- Every form is read, whatever the version.
- Relationships show as names on every client; the plugin keeps exact links where it can.
- A `partner` relationship next to `spouse`.
- The address book is chosen when a contact is created; new cards follow the version the address book uses.

### Non-goals

- Converting cards between versions (the owner decided against an upgrade button: phones rewrite cards in their own
  version anyway).

### Reading

- `RELATED` with a `urn:uuid:` value (as today), with `VALUE=text` (a name), and with the hint parameter
  `X-FRIENDLY-UID=<uid>`: the hint wins when it resolves to a contact, else the value.
- `X-ABRELATEDNAMES` with the label of its group (`X-ABLabel`): `_$!<Label>!$_` and plain labels; a comma-separated
  label (DAVx5 writes e.g. `Domestic-partner, Spouse`) matches when any part matches. The value is a name (with the
  hint parameter when the plugin wrote it). Unlabeled or unknown labels are not mapped (the line stays untouched).
- `X-ABDATE` with label `_$!<Anniversary>!$_` (or plain `Anniversary`) reads as `anniversary` (same date rules as
  `ANNIVERSARY`, including the Apple year-less form).
- Labels per relation row (first one is written; matching ignores case):
  spouse: Spouse · partner: Partner · children: Child · parents: Parent, Mother, Father · siblings: Sibling, Brother,
  Sister · family: Kin, Relative · friends: Friend · colleagues: Colleague, Co-worker, Assistant, Manager ·
  neighbours: Neighbor · housemates: Co-resident · acquaintances: Acquaintance · met: Met · emergency: Emergency.
  Apple's built-in labels use the `_$!<…>!$_` form: Spouse, Partner, Child, Parent, Mother, Father, Brother, Sister,
  Friend, Assistant, Manager; the others are written as plain text.
- New default row `partner` (vCard 4 type `sweetheart`, label Partner, mirrored by itself, single like `spouse`).
  Graph kind: partner.

### Writing (only what changed; untouched lines stay byte-identical)

- vCard 3.0 card: a relationship is `itemN.X-ABRELATEDNAMES;X-FRIENDLY-UID=<uid>:<name>` plus
  `itemN.X-ABLabel:<label>` (N = next free item number; the hint only when the target has a UID). An anniversary is
  `itemN.X-ABDATE:<date>` plus `itemN.X-ABLabel:_$!<Anniversary>!$_` (year-less: Apple form).
- vCard 4.0 card: `RELATED;TYPE=<type>;VALUE=text;X-FRIENDLY-UID=<uid>:<name>`; `ANNIVERSARY` as today.
- `<name>` is the target's display name (`name` property or the contact's name), never a path or alias.
- Removing a relationship removes its line and its label.
- Legacy lines the plugin wrote before (`RELATED…:urn:uuid:…` on a 3.0 card) are rewritten into the 3.0 form on the
  next Apply that writes that card; when this is the only difference, the review screen opens with the line
  "Relationships on this card are rewritten in the form phones understand." and Apply (no property rows).

### New cards and address books

- Each address book gets "New contacts: Automatic / vCard 3.0 / vCard 4.0" (default Automatic). Automatic = the
  version most cards in that address book have (ties and empty books: 3.0, the most widely understood).
- The settings show per address book, on request ("Count card versions"), e.g. "118 × vCard 3.0, 4 × vCard 4.0".
- "Create Contact" gets an **Address book** dropdown listing the enabled address books (default address book
  preselected, or the first enabled one when the default is disabled; hidden with fewer than two enabled address
  books); the choice is written as `source:` in the new note.

### Testing

- Fixtures shaped like DAVx5 3.0 cards (relationships, anniversary, custom labels) and 4.0 cards; reading every form;
  writing per version; legacy rewrite; mapping migration of stored settings (new row `partner`, labels added to
  existing rows, renamed rows keep their names); e2e round trip against Radicale for both versions.
