# Sync against Radicale: automated e2e and manual checklist

## 1. Automated end-to-end suite

`tests/e2e/radicale.e2e.ts` drives the real Sync core (`syncContact`, the CardDAV adapter, `PlatformHttpClient`)
against a real Radicale 3.8.3. The review screen is a fake that applies the preselections plus the choices the scenario names. The note is in memory; the server card is checked with plain HTTP, like `curl`.

The suite starts its own Radicale:

- fresh temp storage;
- `[auth] type = none`;
- a free port;
- the address books `/frank/contacts/` (source "Radicale") and `/frank/family/` (source "Family") are made with MKCOL.

It stops Radicale when done. It is not part of `npm run test:run`.

One-time setup (any python 3):

```sh
python3 -m venv /tmp/radtest/v
/tmp/radtest/v/bin/pip install radicale==3.8.3
```

Run:

```sh
npm run test:e2e
# another python with radicale installed:
RADICALE_PYTHON=/path/to/python npm run test:e2e
```

Without that python the suite is skipped and says so.

Scenarios:

1. The Apple fixture is uploaded as `ABC-DEF.vcf` (href ≠ UID) and imported. The note has friendly properties
   only (no `X-CREATED`), and the base is stored.
2. A local `mobile` edit is pushed. On the server only the TEL value and REV change, and there is still one card at
   `ABC-DEF.vcf`. The next Sync is `unchanged`.
3. A server email edit is pulled into the note, with no PUT.
4. The same field is edited on both sides. The review screen cannot be applied until it is decided; the fake review
   picks the server side (4) or Obsidian (4b). With the server side the note takes the server value and nothing is
   sent. With Obsidian the note's value ends up on the server card and only that line (and REV) differs. 4b starts
   from the server card scenario 4 left behind.
5. `children: ['[[Sem]]']` becomes `itemN.X-ABRELATEDNAMES;X-FRIENDLY-UID=<Sem's UID>:Sem` plus `itemN.X-ABLabel:_$!<Child>!$_` on the 3.0 card.
6. `met-via: '[[Piet]]'` is never sent to the server.
7. A new note without `uid` is `created`. The card is on the server, and the base has the server's href.
8. The first Sync of a converted upstream note changes nothing on the server.
9. A card moves to the second book. If that book already has the UID the move is refused and nothing changes.
10. If the old card changed in the meantime, the move keeps both copies.
11. Cards are imported from both books (`importCandidates`). Each base lands in its own `sync-state/<source id>/`.
12. Changing `source:` and Sync moves the card (the plan is `move`). The card is in the new book, gone from the
    old one, and only the edited line (and REV) differs.
13. A card that is already in the named book is not moved. The other copy stays.
14. A new card follows its book's version: Automatic takes the majority of the cards in the book, and the book's
    setting (vCard 3.0 or 4.0) wins over it.
15. A DAVx5-shaped 3.0 card (`tests/fixtures/davx5V3.vcf`): relationships by label and the anniversary are read,
    including a custom label of two parts with its comma escaped as DAVx5 writes it (`Neighbor\, Acquaintance`;
    Radicale stores it as it is), and the next Sync is `unchanged`. A relationship added in the note adds `itemN.X-ABRELATEDNAMES` with the UID
    hint plus its label and nothing else; removing it takes both lines away again. Radicale upper-cases property
    names and sorts the lines, so the lines are compared without order and case.
16. The same for a 4.0 card: `RELATED;TYPE=<type>;VALUE=text` lines are read, and a new relationship is written as
    `RELATED;TYPE=sweetheart;VALUE=text;X-FRIENDLY-UID=<uid>:<name>` (no item groups, no `X-AB` lines).
17. A 3.0 card with a plugin-written `RELATED;TYPE=child:urn:uuid:…` line: the review shows the rewrite line, Apply
    writes the labelled form and only that line changes. The next Sync is `unchanged`.
18. A card where DAVx5 kept alpha.6's link as the name (`item1.X-ABRELATEDNAMES:urn:uuid:…` on 3.0,
    `RELATED;TYPE=spouse;VALUE=text:urn:uuid:…` on 4.0): it is read as a link to that contact, the review shows only
    the rewrite line, and Apply writes the contact's name with the hint in the line's own form. The next Sync is
    `unchanged`.

Note: `DOMParser` in the suite is jsdom's, with `querySelector('response')` matching prefixed elements
(`CR:address-data`) like Chromium does. Plain jsdom does not match them; Obsidian (Chromium) does.

## 2. Manual checklist in Obsidian

Start a Radicale with a password (port 5299), from the repo root:

```sh
mkdir -p /tmp/radtest/manual
printf 'frank:secret\n' > /tmp/radtest/manual/users
cat > /tmp/radtest/manual/config <<'EOF'
[server]
hosts = 127.0.0.1:5299
[auth]
type = htpasswd
htpasswd_filename = /tmp/radtest/manual/users
htpasswd_encryption = plain
[storage]
filesystem_folder = /tmp/radtest/manual/collections
EOF
/tmp/radtest/v/bin/python -m radicale --config /tmp/radtest/manual/config &

curl -u frank:secret -X MKCOL http://127.0.0.1:5299/frank/contacts/ -H 'Content-Type: application/xml' --data \
  '<?xml version="1.0"?><D:mkcol xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav"><D:set><D:prop><D:resourcetype><D:collection/><C:addressbook/></D:resourcetype></D:prop></D:set></D:mkcol>'
curl -u frank:secret -T tests/fixtures/appleV3.vcf http://127.0.0.1:5299/frank/contacts/ABC-DEF.vcf
```

Look at the server card at any time with:

```sh
curl -u frank:secret http://127.0.0.1:5299/frank/contacts/ABC-DEF.vcf
```

Install the build:

1. Run `npm run build`.
2. Copy `main.js`, `manifest.json` and `styles.css` to `<vault>/.obsidian/plugins/friendly-contacts/`.
3. Enable the plugin.
4. In its settings, click **Add address book** (or use the one already there). In its block enter the URL
   `http://127.0.0.1:5299/frank/contacts/`, user `frank` and password `secret`, then click **Enable**.

Then check. The review screen labels the server column, its pick buttons and "All from ..." with the address
book's name; below that is written as **<book>**.

- [ ] **Import:** click the inbox button in the sidebar's top bar: the Import panel opens, titled by its count and
      an **Import all** button, with a search field. The unknown remote contact is listed under its book as
      `<book> (1)`, as `Name · Org`. Click **Import**: the note shows `name`, `mobile`, `email`,
      `work-email`, `city`, … and no `X-CREATED`. `.obsidian/plugins/friendly-contacts/sync-state/<book id>/` holds the card.
- [ ] **Import panel search and bulk:** with two or more unknown cards in two address books (one named `René`), type
      `rene`: only René stays and the headings count what is visible. Clear it. Click the top **Import all**:
      "Import <n> contacts from <m> address books?". Cancel: nothing is imported. Confirm: all are imported and the
      list says nothing is left. Click **×** on a row: it goes from the list. A book's own **Import all** imports only
      that book. The same card in two books is imported once.
- [ ] **Sync with no differences:** right after an import (or a Sync), run the command *Sync this contact* (or click
      the sidebar's sync icon and choose **Sync**). A notice says "Up to date" and no review screen opens.
- [ ] **Sync button and menu item:** open a contact note: a **Sync contact** icon (refresh) is at the top right of the
      note, and the note's "⋯" menu has **Sync contact**. Both start the same Sync as the command. Open a second
      contact note in a split pane: each pane has one icon, and clicking one syncs that pane's note. A note that is not a
      contact, or no contact note in the pane, has neither. Remove the `name` property of the contact: the icon goes away;
      put it back: one icon returns. Disable every address book: the icon and menu item go away; enable one: they return.
- [ ] **Server-only change:** change the email with `curl -T`, then Sync. The review screen lists only `email`, with
      **<book>** already selected as the result. Click **Apply**: the note shows the new email.
- [ ] **Local-only change:** edit `mobile` in the note, then Sync. Only `mobile` is listed, with **Obsidian**
      selected. Apply. With `curl`, only the TEL value (and REV) changed, and there is still one card.
- [ ] **Conflict:** edit `title` in the note and on the server, then Sync. The `title` row says "Conflict: choose
      one", nothing is selected, **Apply** is disabled and "Decide 1 conflict" is shown next to it. Choose a side:
      Apply is enabled. Check both choices (**<book>**: the note takes the server value; Obsidian: the server card
      gets the note's value).
- [ ] **All from <book> / All from Obsidian:** with a few differing properties (include a conflict), click each
      button. Every listed row follows the button, and Apply is enabled.
- [ ] **Cancel:** open the review with a difference, then click **Cancel** (and try Escape). The note and the server
      card are unchanged, and the next Sync shows the same difference.
- [ ] **Custom edit:** in a text row, type your own value in the "Edit result" field. The Result column shows it. Apply:
      the note and the server card both have your text. Clear the field in a row without a conflict: "(will be
      removed)" appears, and after Apply the property is removed on both sides. Clear it in a conflict row: the row
      is a conflict again and Apply is disabled.
- [ ] **Multi-line value:** give `note` two lines in the note and Sync. Both columns keep the line break, and the
      "Edit result" field has several lines.
- [ ] **New card:** make a contact note without `uid` and Sync. The title is "New card in <book>", the server column
      says "Not in <book> yet", there is no **<book>** button in the rows and no **All from <book>**, every row has
      **Obsidian** selected, and Apply creates the card (check with `curl`).
- [ ] **Show all:** tick **Show all**. The unchanged properties appear dimmed, with their value and no buttons;
      `uid` is never listed.
- [ ] **Address book that cannot be read:** with a second address book enabled, stop its server (or break its
      password), then Sync a contact in the first book. The review screen starts with "Could not read <name>;
      relationships to people only in that address book may show as changed."
- [ ] **Photo difference:** put a different photo on the server card (or change `photo` in the note). The row shows
      thumbnails of both photos, and the chosen one in Result.
- [ ] **Relationship with a person only on the server:** add `RELATED;TYPE=child:urn:uuid:<uid of a card that has no
      note>` to the server card, then Sync. The row lists that person with an **Import** button. Click it: the
      review closes, a note is created for that person, and the review opens again, now showing the person by name.
      With mirroring on, the screen may open once more with the relationship the new note added back.
- [ ] **Also changes:** add a `children` link in the note to a contact note and Sync. The review lists the mirror
      write under **Also changes** (for example `Sem: parents gets [[Jan de Vries]]`), and choosing the other side
      changes that list.
- [ ] **Rename checkbox:** change the name (`name`, or the given/family name) in the note and Sync. The screen offers
      **Rename note to <new name>**, ticked. Apply with it ticked: the note file is renamed and links still resolve.
      Repeat with it unticked: the note keeps its file name. With another note already named the same, the
      checkbox is disabled and says why.
- [ ] **Changed meanwhile (412):** open the review screen, then change the card on the phone or with `curl -T`
      before clicking Apply. After Apply a notice says the contact changed on the server meanwhile, and the review
      opens again with the new server values. Nothing was overwritten.
- [ ] **Mirroring a child/parent:** create a note `Sem` (a contact). Add `children: [[Sem]]` to Jan. `Sem` gets
      `parents: [[Jan de Vries]]`. Remove the child: the parent link goes away too. After **Sync**, the server has
      a `RELATED;TYPE=child:urn:uuid:…` line.
- [ ] **Note-only relation:** add `met-via: [[Piet]]`, then **Sync**. There is no `MET-VIA` line on the server.
- [ ] **Convert command:** put an old-style note (keys like `TEL[CELL]`, `EMAIL[HOME]`) in the contacts folder.
      Run the command *Convert contacts to friendly properties*. The keys become `mobile`, `email`, …, and the body
      is unchanged.
- [ ] **Check relationships:** make a one-sided link (edit Sem's `parents` away by hand). Run the command
      *Check relationships*. It reports the one-sided pair.
- [ ] **Move contacts:** run the command *Move contacts to folder…* and pick a new folder. The notes move, the
      "Contacts folder location" setting follows, and links still resolve.
- [ ] **Folder per contact: switch and put in folders:** Settings → **Contact layout**, set **Layout** to *Folder per
      contact* (name `{{name}}`, *Inside the folder*). The dialog "Put N contacts in their own folder?" appears; choose
      **Not now** and check nothing moved. Run the command *Put each contact in its own folder*. Each contact is now
      `<contacts folder>/<name>/<name>.md`, links still resolve, and the notice says "Moved N, skipped 0, kept 0 folders".
      Run it again: nothing moves ("N contacts were in this layout already" is in the console).
- [ ] **Folder per contact: a poem and a rename:** put a note `poem.md` in Jan's folder. Sync Jan with the server.
      Change Jan's `name` in the note (for example to "Johan de Vries") and Sync: the review offers **Rename folder and
      note to Johan de Vries**, ticked. Apply: the folder and the note carry the new name and `poem.md` is still in
      the folder. With the box unticked nothing is renamed. Make a second contact folder with the target name first:
      the box is disabled and says that a folder or note with that name exists.
- [ ] **Folder per contact: fixed note name:** set **Folder note name** to `index`. The hint "Obsidian's graph and tabs
      will show every contact as "index"." shows. Set *Next to the folder*: the field shows a warning and the setting is
      not saved. Back to *Inside*. Add a child relation to a contact: the link is written as
      `[[<folder>/<name>/index|<name>]]`. Rename a contact through Sync: only the folder is renamed, the note stays
      `index`. Import a server contact that other notes name in a relationship without a note: those entries become
      links to the new note.
- [ ] **Folder per contact: fixed note name with a single contact:** in a contacts folder with only Jan
      (`<folder>/Jan/index.md`, **Folder note name** `index`) and a contact note `Sem.md` that is not in a folder yet,
      add `children: [[Sem]]` to Jan with mirroring on. Sem gets `parents: [[<folder>/Jan/index|Jan]]`, not
      `[[index|Jan]]`. **Sync** Sem: the server card's `RELATED;TYPE=parent` line has Jan's UID. Run *Put each contact
      in its own folder* (now there are two `index.md`): Sem's entry still opens Jan, and a second Sync of Sem
      changes nothing on the server.
- [ ] **Folder per contact: rename with mirroring on:** with `index` as folder note name, give Jan a child Sem (Sem
      gets `parents: [[<folder>/Jan/index|Jan]]`). Change Jan's `name` and Sync with the rename ticked: Sem's entry is
      now `[[<folder>/<new name>/index|<new name>]]`. A label you typed yourself (`[[<folder>/Jan/index|Dad]]`) keeps
      `Dad` and gets the new path.
- [ ] **Folder per contact: rename with Folder Notes "Sync folder name" on:** install Folder Notes (*Inside the
      folder*, name `{{folder_name}}`, *Sync folder name* on) and use `{{name}}` here. Rename a contact through Sync:
      the folder and the note carry the new name once, no error, nothing doubled, and the poem stays in the folder.
- [ ] **Folder per contact: other settings:** with contacts in `<name>/<name>.md` folders, set **Folder note name**
      to `index`. The settings page says "N contacts are in folders made with other settings." Run *Put each contact
      in its own folder*: those contacts are skipped ("already in a folder (different settings)" in the console),
      nothing is nested. Open such a contact's note and create a new contact: it is created next to that folder,
      not in it.
- [ ] **Folder per contact: Copy from Folder Notes:** with the Folder Notes plugin installed and set to another name or
      to "parent folder", the plugin's section shows "Folder Notes uses different settings." Click **Copy from Folder
      Notes**: name and location follow, the warning goes. With Folder Notes set to a type other than `.md`, or to
      the vault folder, a notice says why it cannot be copied and nothing changes.
- [ ] **Folder per contact: take out:** with the poem still in Jan's folder, run *Take contacts out of their folders*.
      Every contact note is `<contacts folder>/<name>.md` again. Folders without other files are gone; Jan's folder
      stays with `poem.md` in it, and the notice counts it as kept.
- [ ] **Folder per contact: relationships still open the contact after take-out:** with `index` as folder note name,
      give Jan a child Sem (Sem gets `parents: [[<folder>/Jan/index|Jan]]`) and a label of your own on another
      entry (`[[<folder>/Jan/index|Dad]]`). Switch to *One note per contact* and take the contacts out. Sem's entries
      open Jan's note `<folder>/Jan.md`; none of them names `Jan (moving)`, and `Dad` is still the label.
- [ ] **Folder per contact: left in folders after going back to one note:** with contacts in `<name>/index.md`
      folders (a poem in Jan's), switch to *One note per contact* without taking them out. A relationship added to
      Jan is written as `[[<folder>/Jan/index|Jan]]`. Change Jan's name on the server and Sync Jan with the rename
      ticked: the folder is renamed (the note stays `index.md`, the poem stays with it) and links to Jan carry the
      new name as their label. Run *Move contacts to folder…*: Jan's whole folder moves, the poem too.
- [ ] **Folder per contact: take out with Folder Notes deleting folder notes:** set Folder Notes to *Storage
      location* "In the parent folder" with *Delete folder notes when deleting the folder* on. Put the contacts in
      folders (*Inside the folder* here), then run *Take contacts out of their folders*: every contact note survives
      as `<contacts folder>/<name>.md` (for a moment it is called `<name> (moving).md`) and the empty folders are gone.
      Switch this plugin to *Next to the folder*, put the contacts in folders and take them out again: the notes
      stay, the empty folders stay too, and the notice says "left N empty folders".
- [ ] **Folder per contact: Move contacts to folder…:** put the contacts in folders again, then run *Move contacts to
      folder…* and pick a new folder. Every contact moves with its whole folder (the poem too), the "Contacts folder
      location" setting follows and links resolve. Try a target that already has a folder with a contact's name: that
      contact is skipped, not merged.
- [ ] **Property names settings:** Settings → **Property names**. Rename `mobile` to `gsm`. Accept the offer to
      rename it in the contact notes. **Sync** still writes the TEL line. *Reset to defaults* brings `mobile` back.
- [ ] **Second address book:** make a distinct card (new UID, name Anna) from the fixture without editing it, and
      put it in a second book:

      ```sh
      curl -u frank:secret -X MKCOL http://127.0.0.1:5299/frank/family/ -H 'Content-Type: application/xml' --data \
        '<?xml version="1.0"?><D:mkcol xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav"><D:set><D:prop><D:resourcetype><D:collection/><C:addressbook/></D:resourcetype></D:prop></D:set></D:mkcol>'
      sed 's/1234ABCD-0000-4000-8000-000000000001/5E4A0000-0000-4000-8000-0000000000AA/; s/Jan/Anna/g' \
        tests/fixtures/appleV3.vcf | curl -u frank:secret -T - http://127.0.0.1:5299/frank/family/anna.vcf
      ```

      In settings click **Add address book**. In the new block set the name `Family`, URL
      `http://127.0.0.1:5299/frank/family/`, user `frank` and password `secret`, then click **Enable**. The default
      book stays the first one.
- [ ] **Import from the second book:** run the command *Import contact from server…*. The list shows both books'
      cards, each with its book name (`<name> · Family`). Import the Family card: the note has `source: Family`,
      and `sync-state/<Family's id>/` holds its card (not the first book's folder). Import another card from the
      sidebar's import button too: same result, with the book that card came from.
- [ ] **Move between books:** in the Family note change `source:` to the first book's name and **Sync**. The review
      screen shows the line "Address book: Family -> <first book's name>" (usually with no property rows to decide).
      *Cancel* leaves everything as it was. **Apply** moves the card: with `curl` it is in the new book and gone from
      the old one, and the notice says it moved. A second **Sync** says "Up to date".
- [ ] **Sync refused:** set `source:` to a name that is not a book (or to a disabled book). **Sync** refuses with a
      notice and nothing changes on either server. A card that is in both books syncs with the book `source:` names
      and leaves the other copy alone.
- [ ] **Rename a book:** Settings → rename `Family` to `Relatives`. The notes with `source: Family` now say
      `source: Relatives`, and **Sync** still works for them.
- [ ] **Remove a book:** try to remove the default book: refused ("Make another address book the default first").
      Try to remove a book that notes use: refused with the number of contacts. Remove a book no note uses: it goes
      and its `sync-state/<id>/` folder is deleted.
- [ ] **Relationships in the sidebar:** with mirroring on, open the sidebar. A contact without relationships shows
      only a small **+ Relationship** button. Click it on Jan, pick Sem, then `children (child)`: Jan's card shows
      `children` with Sem, Sem's card shows `parents` with Jan (and so do the notes). Click Sem's name: Sem's note
      opens. Add Sem again under `children`: a notice says Sem is already listed. Give Jan a `spouse`, then add another
      contact as `spouse`: "Replace <old> with <new> as spouse?"; when the new one already has a spouse of their own,
      the dialog adds that their `spouse` stays as it is. Click **×** next to Sem and confirm: the entry goes from
      Jan, and `parents` from Sem. With two contacts of the same name, the picker shows each one's folder. The
      command *Add relationship…* with Jan's note open does the same; with another note open it says "Open a contact
      note first."
- [ ] **Relationships in the sidebar: Import and Link:** add `friends: ['[[Anna]]']` to Jan by hand, where Anna is a
      card on the server without a note. Anna is grey with an **Import** button: click it, the note is created and
      Anna is no longer grey. Rename Anna's note file to `Anna B.md` (keep `name` and `uid`) and add
      `colleagues: ['[[Sem]]', '[[Anna]]']` to Jan: Anna is grey with **Link**, not Import. Click **Link**: the
      entry becomes a link to `Anna B.md`, still second in the list, and no second Anna note appears. Add
      `family: ['[[Anna]]']` to Jan and pick Anna via **+ Relationship** → `family (kin)`: the grey entry becomes the
      link, without a question, instead of a second entry. Stop the server: grey names show no button, and there is
      one "Could not read <book>" notice, not one per card.
- [ ] **People graph (desktop):** Settings → **This is me** → **Choose** yourself; the description names you. Click
      the ribbon icon **Open people graph**: the graph is drawn around you (larger circle with an accent ring), depth
      2. Give Jan `children: [[Sem]]` and remove `parents` from Sem by hand: centred on Jan the line says `child` next
      to Sem; click Sem (it becomes the centre) and the line says `parent` next to Jan. Add `emergency: [[Piet]]` to
      Jan and centre on Piet: the line says `emergency contact of` next to Jan. Click the centre: its note opens; so do
      **Open note**, a double-click and Ctrl/Cmd-click on any person. Depth 1 hides the people two steps away; turn
      off **Family**: Sem is gone at depth 1. **Everyone** draws all contacts that have a relationship, not the ones
      without. Drag a person: it stays where you drop it; a click that wobbles a few pixels does not pin it or shake
      the graph. **Recenter** lets every dragged person go. Zoom out: dots; zoom in: names, then photos. Add
      `friends: ['[[Contacts/Nobody/index|Nobody Here]]']` to Jan: a dashed ghost named `Nobody Here` appears. With
      Sync on, click a ghost that is a server card without a note: "Looking up <name>…", then "Import <name>?".
      Edit a relationship in a note: the graph follows within a second. Rename and delete a contact note: the graph
      follows, and a deleted centre falls back to you. Close Obsidian with the graph open in a background tab and
      start it again: the graph keeps its centre, depth and kinds and draws when you switch to its tab.
- [ ] **People graph (mobile):** open the graph from the ribbon or the command palette. Tap a person: they become the
      centre. Tap the centre: its note opens. **Open note** opens the centre's note too. Drag a person with one
      finger: it moves and stays; a plain tap does not pin it. Pinch to zoom and drag the background to pan. Clear
      **This is me**, close the graph and open it with no contact note open: with more than 500 contacts the message
      says to set "This is me" or open the graph from a contact; otherwise everyone with a relationship is drawn.
- [ ] **Mirror relationships on this device:** turn it off, then reload the plugin. Adding a child no longer
      touches the other note.
- [ ] **Relationship entered on the phone:** in DAVx5 (Android) or Apple Contacts add a relationship to Jan, for
      example Spouse "Sanne" or Child "Lotte", and let the phone sync to Radicale. In Obsidian run **Sync**: the
      review lists the relationship property (`spouse`, `children`, …) with **<book>** preselected as the result.
      **Apply**: the note has the name. A second **Sync** says "Up to date". A relationship with a label the plugin
      does not know (say "Godfather") is not listed, and stays on the card.
- [ ] **Relationship added in Obsidian shows on the phone:** add `friends: ['[[Sem]]']` to Jan and **Sync**. With
      `curl` the card has `itemN.X-ABRELATEDNAMES;X-FRIENDLY-UID=<Sem's UID>:Sem` and `itemN.X-ABLabel:Friend` (for a
      vCard 4.0 card: `RELATED;TYPE=friend;VALUE=text;X-FRIENDLY-UID=…:Sem`), and every other line is as it was. After
      the phone has synced, Jan shows "Sem" under Friend, not a code. Remove it in Obsidian and **Sync**: the line
      and its label are gone from the card. Do the same with `partner`: the phone shows Partner.
- [ ] **Rewrite line for old `urn:uuid` lines:** put a 3.0 card on the server that holds
      `RELATED;TYPE=child:urn:uuid:<Sem's UID>` (this is what older versions wrote), import it and **Sync**. The review
      screen shows "Relationships on this card are rewritten in the form phones understand." and no property rows.
      *Cancel* leaves the card as it was. **Apply** replaces that line with the `X-ABRELATEDNAMES` line and its label;
      a second **Sync** says "Up to date". A 4.0 card with such a line is left alone.
- [ ] **Create Contact with two books:** with two address books (the first the default), click **Create Contact**:
      the dialog has an **Address book** dropdown with the default selected. Choose the second book and create
      "Test Twee": the note has `source:` with that book's name, and its first **Sync** creates the card in that book
      (not in the other). With one address book the dropdown is not shown.
- [ ] **New contacts version:** in an address book's settings click **Count card versions**: the text reads
      like "3 × vCard 3.0, 0 × vCard 4.0; Automatic gives new contacts vCard 3.0." Set **New contacts** to
      vCard 4.0, create a contact in that book and **Sync**: the card says `VERSION:4.0`. Set it back to Automatic.
