# Links to Obsidian notes on cards — design

Date: 2026-10-20. Status: approved in conversation ("Ja doe maar"), confirmed by the phone tests below; details below marked *(my call)* were settled by
the designer.

## Why

The owner wants to tap from one person to the next in Android Contacts, the way relationship links work in Obsidian.
Android cannot do that: a relationship is stored as a name and a type only (`ContactsContract…Relation.NAME/TYPE`),
and DAVx5 turns any `RELATED` URI into that name as well. A link to another Android contact (its lookup key) only
exists on one device, so a server cannot carry it.

Tested on the owner's phone (Samsung Contacts + DAVx5, 2026-10-21):

- `RELATED;TYPE=spouse:urn:uuid:<uid>` (vCard 4.0) shows as the text "urn:uuid:…", not clickable.
- `RELATED;TYPE=spouse;VALUE=text:Test Twee`, with a contact "Test Twee" on the phone, shows the name, not
  clickable: Samsung does not link by name.
- A person picked on the phone is clickable and survives a DAVx5 sync, but the link is lost as soon as the card
  changes on the server (DAVx5 re-creates the relationship rows).

The plugin keeps writing relationships as now (4.0: `RELATED;VALUE=text;X-FRIENDLY-UID=<uid>:<name>`, 3.0:
`X-ABRELATEDNAMES` with the same hint): the phone shows the name, and the UID stays on the card for any app that
learns to follow it.

What does work: a **website** entry on the card with an `obsidian://` URL. DAVx5 turns `itemN.URL` + `itemN.X-ABLabel`
into a website with a custom label (vcard4android `WebsiteBuilder`), and tapping it opens Obsidian on the phone at the
other person's note, whose relationships are links again.

## Goals

1. A setting, **off by default**: "Links to Obsidian notes on cards".
2. When on, every relationship of a contact that points to a contact note gets a website entry on that contact's card:
   `itemN.URL:obsidian://open?vault=<vault>&file=<note path>` + `itemN.X-ABLabel:<display name>`. In Android
   Contacts it shows as a website labelled "Ger Verhallen".
3. The links stay right by themselves: a relationship added or removed, a note renamed or moved, the vault name
   changed, or the setting turned off — the card's links follow at the contact's next Sync.
4. The links never show up in the note (not as `website`, not anywhere), and never count as a change by the owner.

## Non-goals

- Linking to an Android contact, or making the relationship row itself tappable (impossible, see Why).
- A link to the contact's own note. *(My call: not asked for; easy to add later.)*
- Links for relationships that are only a name (no contact note): they get no link.

## Anti-goals

- A website the owner or the phone wrote is changed or removed. Only links the plugin can recognise as its own are
  touched (see Recognising).
- The owner's `website` property fills up with `obsidian://` links.
- A Sync loop: the same links written again and again.
- Changing `VERSION` or untouched lines (global rule).

## Details

- **Vault name**: by default `app.vault.getName()`. The setting has an optional field "Vault name on your phone" for
  a phone vault with another name. *(My call.)*
- **URL**: `obsidian://open?vault=<encodeURIComponent(vault)>&file=<encodeURIComponent(path without .md)>`, the form
  Obsidian's own "Copy Obsidian URL" produces.
- **Label**: the other person's display name (the same name written on relationship lines: `RelationContext.displayName`).
  *(My call: Android shows the label above the URL; the relationship type is already visible in the relationship
  rows.)*
- **Order and form**: one link per distinct contact note, in the order of the relationship properties as they appear in
  the mapping, then the order in the note. Both vCard 3.0 and 4.0 use the same `itemN.URL` + `itemN.X-ABLabel` form.
- **Recognising**: DAVx5 drops unknown parameters, so a marker parameter would not survive. A line is the plugin's own
  when its value starts with `obsidian://open?` and its `vault` parameter is this vault's name (or the configured phone
  vault name). *(My call.)* Such lines (and their `X-ABLabel` lines) are excluded from reading (never a `website`
  value) and from the review rows.
- **When links are written**: Sync computes the wanted links from the note's relationships. When the card's own links
  differ from that (missing, extra, changed URL or label), the card needs a rewrite, exactly like the legacy
  relationship rewrite (Part 6): the review screen opens with an info line, and Apply writes them. With no other
  difference the review shows only that line. Text of the info line: "Links to Obsidian notes on this card are updated."
  *(My call.)*
- **Setting off**: the plugin's own links are removed at each contact's next Sync (same info line).
- **New cards**: get the links when the setting is on.
- **Import**: an imported card's plugin links are ignored like on every read.
- **Base and comparison**: links are left out of the three-way comparison; only the rewrite decides about them.

## Testing

- Unit: links written for 3.0 and 4.0; recognising own links vs a website the owner wrote (also an `obsidian://` link
  to another vault); reading never yields them; a rename changes the URL and triggers the rewrite once, then up to
  date; setting off removes them; untouched lines byte-identical; group numbers never collide.
- e2e against Radicale: a card with the setting on round-trips; the second Sync is up to date.
- README: what the setting does, that it is for phones (Android: website entries), the vault-name field, and that it
  must be tested once on the phone (whether the contacts app opens `obsidian://` links depends on the app).
