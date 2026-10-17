# Sync against Radicale: automated e2e and manual checklist

## 1. Automated end-to-end suite

`tests/e2e/radicale.e2e.ts` drives the real Sync core (`syncContact`, the CardDAV adapter, `PlatformHttpClient`)
against a real Radicale 3.8.3. The note is in memory; the server card is checked with plain HTTP, like `curl`.

The suite starts its own Radicale:

- fresh temp storage;
- `[auth] type = none`;
- a free port;
- the address book `/frank/contacts/` is made with MKCOL.

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
- [ ] **Mirror relationships on this device:** turn it off, then reload the plugin. Adding a child no longer
      touches the other note.
