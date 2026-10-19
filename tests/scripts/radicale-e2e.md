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
5. `children: ['[[Sem]]']` becomes `RELATED;TYPE=child:urn:uuid:<Sem's UID>` on the server.
6. `met-via: '[[Piet]]'` is never sent to the server.
7. A new note without `uid` is `created`. The card is on the server, and the base has the server's href.
8. The first Sync of a converted upstream note changes nothing on the server.
9. A card moves to the second book. If that book already has the UID the move is refused and nothing changes.
10. If the old card changed in the meantime, the move keeps both copies.
11. Cards are imported from both books (`importCandidates`). Each base lands in its own `sync-state/<source id>/`.
12. Changing `source:` and Sync moves the card (the plan is `move`). The card is in the new book, gone from the
    old one, and only the edited line (and REV) differs.
13. A card that is already in the named book is not moved. The other copy stays.

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

- [ ] **Import:** Insights panel → import the unknown remote contact. The note shows `name`, `mobile`, `email`,
      `work-email`, `city`, … and no `X-CREATED`. `.obsidian/plugins/friendly-contacts/sync-state/<book id>/` holds the card.
- [ ] **Sync with no differences:** right after an import (or a Sync), run the command *Sync this contact* (or click
      the sidebar's sync icon and choose **Sync**). A notice says "Up to date" and no review screen opens.
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
- [ ] **Folder per contact: Copy from Folder Notes:** with the Folder Notes plugin installed and set to another name or
      to "parent folder", the plugin's section shows "Folder Notes uses different settings." Click **Copy from Folder
      Notes**: name and location follow, the warning goes. With Folder Notes set to a type other than `.md`, or to
      the vault folder, a notice says why it cannot be copied and nothing changes.
- [ ] **Folder per contact: take out:** with the poem still in Jan's folder, run *Take contacts out of their folders*.
      Every contact note is `<contacts folder>/<name>.md` again. Folders without other files are gone; Jan's folder
      stays with `poem.md` in it, and the notice counts it as kept.
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
- [ ] **Mirror relationships on this device:** turn it off, then reload the plugin. Adding a child no longer
      touches the other note.
