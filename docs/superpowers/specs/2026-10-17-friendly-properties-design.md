# Friendly contact properties, lossless sync and two-way relationships

Status: draft, 2026-10-17. Fork-only for now (frankhommers/obsidian-vcf-contacts); upstreaming is a later decision.
Decisions marked *(builder's call)* were made while writing this, not by the owner; they can be challenged.

## Why

The plugin stores contacts as notes whose frontmatter *is* the vCard: `TEL[CELL]`, `ADR[HOME].STREET`, `N.GN`, `X-ABLABEL`.
That reads like a database dump, not like a note about a person. The owner wants to write about people (anecdotes, how they
know them, who belongs to whom) and keep contact details in sync with Radicale, which the family shares per address book.

Wanted:

1. **Readable properties** with English names:

   ```yaml
   ---
   name: Jan de Vries
   firstname: Jan
   lastname: de Vries
   mobile: 06-12345678
   email: jan@example.nl
   work-email: jan@company.nl
   birthday: 1975-03-12
   city: Utrecht
   spouse: "[[Anna de Vries]]"
   children:
     - "[[Sem de Vries]]"
   uid: urn:uuid:1234...
   ---
   ## 2026-10-12, my 50th
   Brought whisky and the camping story from '98.
   ```

2. **Real relationships**: standard `RELATED;TYPE=spouse:urn:uuid:<uid>` in the vCard, `[[links]]` in the note,
   **mirrored automatically** (setting `spouse: [[Anna]]` on Jan sets `spouse: [[Jan]]` on Anna).

3. **A sync that never loses data on the server.** Found while reviewing this design (see "Current data loss").

## Goals

- A configurable mapping table (plugin settings) between friendly property names and vCard fields.
- Defaults derived from the owner's actual address book, work and private kept separate.
- Sync that only changes on the server what was changed in Obsidian, and only changes in the note what changed on the
  server. Untouched vCard lines stay byte-identical (types, Apple labels, groups, PREF, unknown fields).
- Two-way `RELATED`, with mirroring between contact notes.
- Properties the user adds that are not in the mapping (`met-via`, `tags`, ...) stay in Obsidian, never pushed.

## Non-goals

- Changing which contacts get imported (separate topic: not every Radicale contact needs a note).
- Showing relationships on iPhone (Apple ignores `RELATED`; `X-ABRELATEDNAMES` export can come later).
- Syncing the note body. The body is for private stories and is never sent to Radicale.
- Mobile sync (the HTTP client is Node-only; unchanged).
- Automatic background sync. Sync stays a user action per contact (plus existing batch import).

## Anti-goals

- Pushing a note removes or relabels anything on the server that the user did not change in Obsidian.
- Junk vCard lines on the server such as `SPOUSE:[[Anna de Vries]]` or `MET-VIA:...`.
- Mirroring that re-adds a relationship the user just removed, or fights between devices.
- Obsidian property type warnings because a property is a list in one note and text in another.
- Technical vCard noise in the note (`X-CREATED`, `REV`, labels, `VERSION`).

## Current data loss (upstream behaviour, verified in source)

`src/contacts/vcard/parse.ts` (`parseVCardLine`) and `src/sync/sync.ts` (`pushToRemote`):

- Grouped Apple lines (`item1.TEL;...`, `item1.EMAIL;...`, `item1.URL;...`, `item1.X-ABLabel:...`) are dropped entirely:
  `ITEM1.TEL` is not a supported key. The owner has 92 `X-ABLABEL` lines, so roughly 92 phone numbers, emails, URLs or
  dates are invisible in Obsidian today.
- Repeated `TYPE` parameters keep only the last: `TEL;type=CELL;type=VOICE;type=pref` becomes `TEL[pref]`.
- All parameters except `TYPE` are dropped (`VALUE=`, `LABEL=`, ...). `PRODID`, `IMPP`, `RELATED` are dropped.
- `pushToRemote` rebuilds the whole card from frontmatter and PUTs it without `If-Match`. Everything the parser dropped,
  plus `NOTE` (moved to the body on import), plus anything changed on a phone since the last pull, is deleted on the server.
- `updateFromRemote` only adds/overwrites; fields deleted on the server survive in the note and get pushed back.

This design replaces that sync path; it does not try to patch it.

## Owner's data (field counts across 232 contacts, `itemN.` prefix stripped)

```
231 X-CREATED          36 TEL[WORK]       12 NICKNAME              5 URL[HOME]      1 X-ABSHOWAS
164 TEL[CELL]          23 TEL             10 EMAIL[HOME,INTERNET]  3 X-ABDATE       1 URL[WORK]
149 EMAIL[INTERNET]    23 NOTE             8 EMAIL                 3 ADR            1 TEL[PAGER]
 92 X-ABLABEL          22 ADR[HOME]        7 TEL[HOME]             2 TEL[WORK,FAX]  1 EMAIL[WORK]
 88 ORG                19 BDAY             6 ADR[WORK]             2 TEL[MAIN]      1 EMAIL[INTERNET,PREF]
 69 URL                18 EMAIL[WORK,INTERNET]                                      1 EMAIL[HOME]
                       16 TITLE                                                     1 CATEGORIES
plus FN, N, UID, VERSION, PRODID/REV on (nearly) every card. Mostly vCard 3.0 from Apple. No RELATED yet.
```

## Architecture

Three layers, each a pure module without Obsidian or UI imports (unit-testable), under `src/contacts/friendly/`:

1. **Line model** (`lines.ts`). Lossless vCard parse/serialise: each content line becomes
   `{ group?, name, params: [name, value][], value, raw }`. Unfolding/folding, repeated params, groups, unknown properties
   all preserved. `serialise(parse(card))` must reproduce every line (folding and CRLF may be normalised).
2. **Translator** (`translate.ts`, `mapping.ts`). `toFriendly(lines, ctx)` returns the friendly properties **and the
   provenance** of each (which line, which ADR/N component). `patch(baseLines, oldFriendly, newFriendly, ctx)` returns
   new lines: changed values are rewritten in place on their source line, removed values delete their line (or component),
   added values append a line using the row's write key. Lines that no friendly property touches are left alone.
3. **Relations** (`relations.ts`). Link <-> UID resolution and the mirroring diff.

`ctx` supplies lookups the modules must not own: UID -> note basename, link -> UID, remote contact list.

The **legacy record** (`TEL[CELL]`-style keys) stays as the interface for the sidebar, context menu, avatar and export.
It is derived from the line model (fixing the TYPE-merge bug there), so the UI needs no rewrite. `vcard.parse` and the
existing tests keep their contract; new code paths stop using the record for sync.

### Sync state (base)

Lossless patching and three-way merge need the card as it was at the last successful sync.

- After every successful pull or push, store the server card text and its ETag as the **base** for that UID.
  *(builder's call)* Location: `<plugin dir>/sync-state/<uid>.vcf` + etag in a small index. Not in the note.
- No base (old notes, another device, cleared state): the first sync treats the current server card as base and runs
  a merge where the server wins on conflicting fields; a Notice lists what was overwritten.

### Sync operation

Pull and push become one **Sync** action per contact (existing buttons keep working, both call it):

1. Fetch server card S (with ETag). Base B. Local L = friendly properties of the note.
2. Translate S and B to friendly: `F(S)`, `F(B)`.
3. Per friendly property:
   - `L == F(B)`: take `F(S)` (server change, including deletions).
   - `F(S) == F(B)`: take `L` (local change, including deletions).
   - both changed, equal: fine.
   - both changed, different: **conflict**. *(builder's call)* Server wins in the note; the local value is shown in a
     Notice and appended to the note body under a `> [!warning] Sync conflict` callout so nothing is lost silently.
4. Write merged values to the note (`app.fileManager.processFrontMatter`, local-only properties untouched).
5. `patch(S, F(S), merged)` -> new card. If it differs from S, PUT with `If-Match: <etag>`. On 412: restart from step 1
   (once; then report).
6. Store the result as new base.

Import of an unknown remote contact = create note from `toFriendly(S)`, store base.
"Import All" and batch behaviour stay as they are.

### Where the translator plugs in

| Place | Change |
|---|---|
| `getFrontmatterFromFiles` | contact detection also accepts `name`/`firstname`/`lastname`; returns the legacy record via the translator |
| `pushToRemote`, `updateFromRemote` | replaced by the Sync operation above |
| `vcard.toString` (export) | built from base lines patched with the note when a base exists, else from friendly -> lines |
| `mdRender`, `frontMatterRender`, `createEmpty`, `addDefaultFields`, `createFieldsKeys` | write friendly names |
| `updateFrontMatterValue` (UID, PHOTO, avatar) | callers pass vCard keys; translated; implemented with `processFrontMatter` |

Old-style notes (raw vCard keys) are still read: keys that are valid vCard keys are understood as such.
A command **"Convert contacts to friendly properties"** rewrites them. *(builder's call)* It leaves the body (including
upstream's `#### Notes` text) alone; the server `NOTE` comes in as `note` on the first sync.
A setting **"Friendly properties"** (default on in this fork) switches the writer.

## Mapping table

### Matching (vCard -> friendly)

- Groups (`item1.`) are ignored for matching; the line keeps its group on the server.
- TYPE values are normalised for matching only: upper-case, drop `INTERNET`, `PREF`, `VOICE`, ignore order.
  So `item1.TEL;type=CELL;type=VOICE;type=pref` matches `TEL[CELL]` -> `mobile`.
- Each row has one or more read patterns and one write key (used only for **new** values; edits keep the line's
  original type, group and params).
- First matching row wins. Lines matched by no row are not shown and are preserved on the server.

### Default rows

| Friendly | Reads | Writes new values as |
|---|---|---|
| `name` | `FN` | `FN` |
| `firstname` / `middlename` / `lastname` | `N` given / additional / family | `N` |
| `nickname` | `NICKNAME` | `NICKNAME` |
| `mobile` | `TEL[CELL]` | `TEL;TYPE=CELL` |
| `phone` | `TEL`, `TEL[HOME]`, `TEL[MAIN]` | `TEL;TYPE=HOME` |
| `work-phone` | `TEL[WORK]` | `TEL;TYPE=WORK` |
| `email` | `EMAIL`, `EMAIL[HOME]` | `EMAIL;TYPE=HOME` |
| `work-email` | `EMAIL[WORK]` | `EMAIL;TYPE=WORK` |
| `website` | `URL`, `URL[HOME]` | `URL` |
| `work-website` | `URL[WORK]` | `URL;TYPE=WORK` |
| `company` | `ORG` | `ORG` |
| `title` | `TITLE` | `TITLE` |
| `role` | `ROLE` | `ROLE` |
| `birthday` | `BDAY` | `BDAY` |
| `anniversary` | `ANNIVERSARY` | `ANNIVERSARY` |
| `street`, `postcode`, `city`, `region`, `country` | `ADR`, `ADR[HOME]` components | `ADR;TYPE=HOME` |
| `work-street`, `work-postcode`, `work-city`, `work-region`, `work-country` | `ADR[WORK]` components | `ADR;TYPE=WORK` |
| `note` | `NOTE` | `NOTE` |
| `categories` | `CATEGORIES` (comma split) | `CATEGORIES` |
| `photo` | `PHOTO` | `PHOTO` |
| `uid` | `UID` | `UID` |
| relationship rows | see below | |

Address: only the first `ADR`/`ADR[HOME]` and first `ADR[WORK]` are shown; further addresses are preserved but hidden.
`ADR` PO box / extended components are preserved, not shown. Clearing all components of an address deletes the line.

### Multiple values

Obsidian property types are vault-wide, so a property must not be text in one note and a list in another.

- Contact fields are always **text**. Further values of the same kind get numbered names: `mobile`, `mobile-2`, ...
  in server line order. Adding `mobile-2` appends a line; clearing it deletes that line.
- Relationship fields are always **lists**, except `spouse` (text; a second one becomes `spouse-2`).
- `categories` is always a list.
- `birthday`/`anniversary` written as `YYYY-MM-DD` (Obsidian date type); server format kept on unchanged lines.

### Local-only properties

Keys that are not a mapping row or a relationship row (`met-via`, `tags`, `aliases`, `cssclasses`, anything) are never
pushed and never touched by sync.

### Settings UI

Section "Property names": list of rows (friendly name, read patterns, write key), editable, "Reset to defaults".
Validation: friendly names unique and not themselves vCard keys. Renaming offers to run the convert command.
Widget is the builder's choice.

## Relationships

### vCard side

- With a known contact: `RELATED;TYPE=spouse:urn:uuid:<uid>`.
- Without one: `RELATED;TYPE=friend;VALUE=text:Anna de Vries`.
- vCard 3.0 cards (Apple) do not define `RELATED`; Radicale stores it fine and Apple ignores it. Do not change `VERSION`.

### Relationship rows

| Friendly (list unless noted) | vCard TYPE | Mirror |
|---|---|---|
| `spouse` (text) | `spouse` | `spouse` |
| `children` | `child` | `parents` |
| `parents` | `parent` | `children` |
| `siblings` | `sibling` | `siblings` |
| `family` | `kin` | `family` |
| `friends` | `friend` | `friends` |
| `colleagues` | `colleague`, `co-worker` | `colleagues` |
| `neighbours` | `neighbor` | `neighbours` |
| `housemates` | `co-resident` | `housemates` |
| `acquaintances` | `acquaintance` | `acquaintances` |
| `met` | `met` | `met` |
| `emergency` | `emergency` | none (one-way) |

Other TYPEs (`contact`, `agent`, `muse`, `crush`, `date`, `sweetheart`, `me`, none) are preserved on the server, not shown.

### Server -> note (UID -> link)

1. A contact note with that UID exists: `[[<its basename>]]`.
2. Else the UID is in the remote list: `[[<file name that contact would get on import>]]`, computed with
   `createNameSlug` logic (N parts for individuals, else FN). `getMetaList` must therefore also return the N parts
   (extend the REPORT / parse; it already fetches address-data).
3. Else (unknown UID): not shown, preserved on the server.
4. `VALUE=text` relations: `[[<text>]]`.

### Note -> server (link -> UID)

1. Link resolves (`metadataCache.getFirstLinkpathDest`) to a contact note with a UID: `urn:uuid:<uid>`.
   No UID yet: assign one (existing `UidProcessor` behaviour).
2. Unresolved: match link text against remote contacts' import file names. Exactly one: its UID.
3. None: `VALUE=text:<link text>`.
4. Several: do not guess; push as `VALUE=text` and show a Notice naming the ambiguous link.

An unchanged relationship keeps its original server line (provenance), so case 2-4 only run for new/edited links.

### Mirroring

Mirroring happens between notes; each side reaches Radicale when that note is synced.

- In-memory snapshot of every contact note's relationship properties, built on load, updated on change.
- On `metadataCache` `changed` for a contact note, diff against the snapshot:
  - Added `children: [[Sem]]`, Sem has a note: ensure Sem has `parents: [[Jan]]`.
  - Removed: remove the inverse from the other note only if it points back to this note.
  - Target has no note: nothing now (see import).
- On import/creation of a contact note: backlinks from other notes' relationship properties add the inverses here;
  this note's own relationships are mirrored onto existing notes.
- On rename: Obsidian updates links; refresh snapshot only.
- All writes via `processFrontMatter`. Mirror writes must not trigger mirroring again (compare with snapshot so the
  echo is a no-op).
- Writes are idempotent ("ensure present" / "ensure absent"), so two devices reacting to the same synced edit converge.
  *(builder's call)* Setting "Mirror relationships on this device", default on for desktop, off on mobile, to avoid
  sync-conflict noise from the phone.
- No automatic reconcile on load (cannot tell a removal from an addition after offline edits). Command
  **"Check relationships"** lists one-sided relationships and offers per item: add the inverse, or remove.
- Changes that arrive through Sync mirror like manual edits.

### Link format

- Properties only support wiki-style links (`"[[...]]"`), also when "Use [[Wikilinks]]" is off, so relationship
  properties are always written as `[[...]]`.
- The link text follows the vault's "New link format" setting (shortest path / relative / absolute): it is produced by
  Obsidian (`metadataCache.fileToLinktext(file, sourcePath)`), never built from the file name by hand.
- Links are always resolved through Obsidian (`getFirstLinkpathDest(linkpath, sourcePath)`), never compared as text:
  `[[Anna de Vries]]`, `[[People/Anna de Vries]]` and `[[Anna de Vries|Anna]]` are the same person.
- Reading also accepts a markdown link typed by hand (`[Anna](People/Anna%20de%20Vries.md)`).
- A contact that only exists in Radicale (no note yet) is written as `[[<file name it would get on import>]]`.

## Moving contacts

- Command **"Move contacts to folder…"**: pick a folder, all contact notes move there (sub-folders inside the contacts
  folder keep their relative place), then the contacts folder setting is updated.
- Changing the contacts folder in settings offers the same move ("Move 87 contacts from People to Areas/People?").
- Moves go through `app.fileManager.renameFile`, so Obsidian updates links in other notes per the user's settings.
- A target file that already exists is skipped and reported, never overwritten.
- Sync state and relationships are keyed by UID, so moving changes nothing there.

## Testing

- `lines.ts`: round trip on fixtures, including an Apple 3.0 card shaped like the owner's data (`item1.TEL;type=CELL;
  type=VOICE;type=pref`, `item1.X-ABLabel`, `EMAIL;type=INTERNET`, `X-CREATED`, folded `PHOTO`, `NOTE` with escapes).
- `translate.ts`:
  - mapping matches (each default row, normalisation, groups);
  - numbering (`mobile-2`);
  - `patch` with no changes returns identical lines;
  - edit keeps type/group/params;
  - add uses the write key;
  - delete removes only that line / component.
- Three-way merge: server-only change, local-only change, both same, conflict, server deletion, local deletion, no base.
- Local-only properties never reach the card.
- Relationship resolution cases for both directions, including ambiguous names and unknown UIDs.
- Mirroring diff: add, remove, remove when the other side does not point back, echo suppression, child/parent.
- Existing tests keep passing (the TYPE-merge fix may require updating expectations that encode the bug); `npm run build`.
- Manual run against local Radicale 3.8.3 (`/tmp/radtest`):
  - import, edit, Sync;
  - change on the server, Sync;
  - conflict;
  - verify server cards byte-for-byte on untouched lines.

## Left to the builder

- Settings widget; snapshot/echo-guard mechanics; Notice wording; the base storage format details.
- Keeping `firstname`/`lastname` alongside `name` (keep: Apple needs `N`).
