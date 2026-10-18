# Sync against Radicale: automated e2e and manual checklist

## 1. Automated end-to-end suite

`tests/e2e/radicale.e2e.ts` drives the real Sync core (`syncContact`, the CardDAV adapter, `PlatformHttpClient`)
against a real Radicale 3.8.3. The note is in memory; the server card is checked with plain HTTP, like `curl`.

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
4. The same field is edited on both sides. The server value is kept, the local value goes into a callout, and a
   notice is shown.
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
4. In its settings, set the CardDAV address book URL to `http://127.0.0.1:5299/frank/contacts/`, the user to `frank`
   and the password to `secret`. Turn sync on.

Then check:

- [ ] **Import:** Insights panel → import the unknown remote contact. The note shows `name`, `mobile`, `email`,
      `work-email`, `city`, … and no `X-CREATED`. `.obsidian/plugins/friendly-contacts/sync-state/` holds the card.
- [ ] **Sync menu item:** edit `mobile` → sidebar → the contact's sync icon → **Sync**. With `curl`, only the TEL
      value (and REV) changed, and there is still one card.
- [ ] **Server edit:** change the email with `curl -T`, then **Sync**. The note shows the new email.
- [ ] **Conflict:** edit `title` in the note and on the server, then **Sync**. The server value is kept, a callout
      with your value is at the end of the note, and a notice is shown.
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
- [ ] **Property names settings:** Settings → **Property names**. Rename `mobile` to `gsm`. Accept the offer to
      rename it in the contact notes. **Sync** still writes the TEL line. *Reset to defaults* brings `mobile` back.
- [ ] **Second address book:** create `/frank/family/` the same way as `contacts` (MKCOL) and put a card in it:
      `curl -u frank:secret -T tests/fixtures/appleV3.vcf http://127.0.0.1:5299/frank/family/anna.vcf`, after
      changing its `UID:` line to a new value. In settings add an address book, name it `Family`, URL
      `http://127.0.0.1:5299/frank/family/`, user `frank`, password `secret`, and enable it. The default book stays
      the first one.
- [ ] **Import from the second book:** run the command *Import contact from server…*. The list shows both books'
      cards, each with its book name (`<name> · Family`). Import the Family card: the note has `source: Family`,
      and `sync-state/<Family's id>/` holds its card (not the first book's folder). Import another card from the
      sidebar's import button too: same result, with the book that card came from.
- [ ] **Move between books:** in the Family note change `source:` to the first book's name and **Sync**. Confirm
      the move dialog (*Cancel* leaves everything as it was). With `curl` the card is in the new book and gone from
      the old one, and the notice says it moved. A second **Sync** says the note is already in sync.
- [ ] **Sync refused:** set `source:` to a name that is not a book (or to a disabled book). **Sync** refuses with a
      notice and nothing changes on either server. A card that is in both books syncs with the book `source:` names
      and leaves the other copy alone.
- [ ] **Rename a book:** Settings → rename `Family` to `Relatives`. The notes with `source: Family` now say
      `source: Relatives`, and **Sync** still works for them.
- [ ] **Remove a book:** try to remove the default book: refused ("Make another address book the default first").
      Try to remove a book that notes use: refused with the number of contacts. Remove a book no note uses: it goes,
      and its `sync-state/<id>/` folder is no longer used.
- [ ] **Mirror relationships on this device:** turn it off, then reload the plugin. Adding a child no longer
      touches the other note.
