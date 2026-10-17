# Friendly Properties, Lossless Sync and Relationships Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Contact notes use readable English properties, sync with CardDAV changes only what changed on either side,
and `RELATED` relationships appear as mirrored `[[links]]`.

**Architecture:**
- **Pure core** in `src/contacts/friendly/` (no Obsidian imports):
  - a lossless vCard line model;
  - a mapping-table translator with provenance and patching;
  - a three-way merge;
  - relationship diffing.
- **Obsidian-facing layer:** thin adapters that read and write notes, store the sync base, and mirror relationships.
- **UI and export:** the existing legacy record (`TEL[CELL]` keys) stays the interface for sidebar/export; it is
  derived from the friendly note via the line model.

**Tech Stack:** TypeScript, Obsidian API (`processFrontMatter`, `metadataCache`, `vault.adapter`), React 18 settings UI, vitest.

**Spec:** `docs/superpowers/specs/2026-10-17-friendly-properties-design.md`

## Global Constraints

- Commits: never add `Co-Authored-By` or mention any LLM/agent.
- HTTP only through `PlatformHttpClient` (Node `https`); never `fetch` (CORS) — from `prompting.md`.
- Business logic outside `.tsx`; UI only calls core modules — from `prompting.md`.
- Core modules under `src/contacts/friendly/` import nothing from `obsidian` and nothing from `src/context/*`.
- Test command: `npm run test:run`. Build: `npm run build`. Both must pass at the end of every task.
- Note body is never sent to the server.
- Properties not in the mapping and not relationship rows are never pushed and never modified by sync.
- Unchanged vCard lines are written back exactly as parsed (same group, params, value). Folding/CRLF may be normalised.
- Contact fields are text; relationship fields are lists except `spouse`; `categories` is a list; extra values are `<property>-2`, `-3`, ...
- Friendly names and inverse table exactly as in the spec's "Default rows" and "Relationship rows" tables.
- Deviation from spec, *(builder's call)*: no "Friendly properties" on/off toggle. The fork always writes friendly
  properties and always reads old-style notes. A second writer would double every code path for no user.

## Review Focus

1. **iPhone-created contacts have an href that is not `<uid>.vcf`.**
   - Sync must PUT to the existing href and never create a second card.
   - Test: Task 8 `puts to the existing href, not uid.vcf`.
2. **Apple year-less birthdays** (`BDAY;X-APPLE-OMIT-YEAR=1604:1604-03-12`) and vCard 4 `BDAY:--0312`.
   - Untouched, they round-trip byte-identical.
   - Shown as-is (`1604-03-12`, `--03-12`).
   - Tests: Task 3 `keeps apple year-less birthday`, Task 4 `untouched birthday line is identical`.
3. **Escaped text** (`ORG:Bakker\, Zonen`, `NOTE:line1\nline2`, `ADR` with `\;`).
   - Shown unescaped.
   - Escaped again when written.
   - Untouched lines stay identical.
   - Tests: Task 1 `unescapes and escapes text`, Task 4 `re-escapes edited values`.
4. **YAML coerces values.** `mobile: 0612345678` may come back as a number, a value may be `null`, an unquoted date may
   be a `Date`, or a list may appear where text is expected.
   - The translator coerces to string and must never crash.
   - A list in a text property takes the first item and adds a warning naming the property.
   - Test: Task 5 `coerces yaml values from the note`.
5. **Two contacts with the same name.**
   - Link resolution must not guess.
   - Mirroring must target the note the link resolves to, not a same-named remote contact.
   - Tests: Task 6 `ambiguous remote name resolves to text`, Task 10 `mirrors to the resolved note only`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/contacts/friendly/lines.ts` | Lossless parse/serialise of one vCard; escaping; type helpers |
| `src/contacts/friendly/mapping.ts` | Mapping row types, `DEFAULT_MAPPING`, pattern matching, inverse lookup |
| `src/contacts/friendly/translate.ts` | `toFriendly` (lines -> properties + provenance), `patch` (properties -> lines) |
| `src/contacts/friendly/merge.ts` | Three-way merge of friendly properties, note value coercion |
| `src/contacts/friendly/relations.ts` | Link parsing, relation snapshot diff, mirror write planning, `RelationContext` type |
| `src/contacts/friendly/index.ts` | Re-exports |
| `src/sync/syncState.ts` | Base store (`<plugin dir>/sync-state/`) behind a small file interface |
| `src/sync/syncContact.ts` | The Sync operation (fetch, merge, write note, patch, PUT with If-Match, store base) |
| `src/sync/adapters/carddavGeneric.ts` (modify) | ETag on pull, `If-Match` + href on push, `N` in meta list |
| `src/contacts/friendlyNotes.ts` | Obsidian boundary: read/write friendly frontmatter, render new notes, legacy record for UI, `ObsidianRelationContext` |
| `src/contacts/relationMirror.ts` | Obsidian wiring for mirroring (snapshot, `changed` events, writes) |
| `src/ui/settings/components/propertyNamesSettings.tsx` | Mapping table editor + mirror toggle |
| `src/ui/modals/checkRelationsModal.ts` | "Check relationships" result list |
| Tests | `tests/friendly/*.spec.ts`, `tests/syncContact.spec.ts`, fixture `tests/fixtures/appleV3.vcf` |

---

### Task 0: Branch, fixes and plugin identity

**Files:**
- Modify: `manifest.json`, `package.json`, `versions.json`, `README.md`

- [ ] **Step 1: Bring both upstream PR branches into the fork's `master` and rebase the feature branch**

```bash
git checkout master && git merge --no-ff fork/fix/carddav-content-length && git merge --no-ff fork/fix/settings-credentials
git push fork master
git checkout feature/friendly-properties && git rebase master
```

Expected: no conflicts (the branches touch different files except `carddavGeneric.ts`, where the credentials branch
changed `checkConnectivity` only).

- [ ] **Step 2: Give the fork its own identity**

In `manifest.json`:
- `"id": "vcf-contacts-friendly"`
- `"name": "VCF Contacts Friendly"`
- `"version": "3.0.0-alpha.1"`
- keep `author`
- set `"forkedFrom": "https://github.com/broekema41/obsidian-vcf-contacts"`

Mirror `version` in `package.json` and add `"3.0.0-alpha.1": "1.4.10"` to `versions.json`. Add a README section
"About this fork" (one paragraph: friendly properties, lossless sync, relationships; settings are separate from the
original plugin, copy `data.json` to migrate).

- [ ] **Step 3: Verify and commit**

Run: `npm run test:run && npm run build` — Expected: all tests pass, build succeeds.

```bash
git commit -am "chore: own plugin id for the friendly fork"
```

---

### Task 1: Lossless line model

**Files:**
- Create: `src/contacts/friendly/lines.ts`, `tests/friendly/lines.spec.ts`, `tests/fixtures/appleV3.vcf`

**Interfaces:**
- Produces:
  - `interface VCardLine { group?: string; name: string; params: [string, string][]; value: string }`
    - `name` and param names upper-case; param values and `value` exactly as on the wire (still escaped)
    - a param without `=` (vCard 2.1 `TEL;CELL:`) is stored as `['TYPE', 'CELL']`
  - `parseCard(raw: string): VCardLine[]` — one card; unfolds CRLF/LF + space/tab; drops `BEGIN`/`END`; keeps everything
    else in order; splits value at the first `:` outside a quoted param value
  - `serializeCard(lines: VCardLine[]): string` — `BEGIN:VCARD\r\n` + lines + `END:VCARD\r\n`, CRLF, folded at 75 octets
    (never inside a UTF-8 sequence)
  - `serializeLine(line: VCardLine): string` — unfolded single line
  - `typesOf(line: VCardLine): string[]` — all TYPE values (repeated params and comma lists), upper-case
  - `matchTypes(line: VCardLine): string[]` — `typesOf` minus `INTERNET`, `PREF`, `VOICE`, sorted
  - `getParam(line: VCardLine, name: string): string | undefined`
  - `unescapeText(v: string): string` / `escapeText(v: string): string` — `\\`, `\,`, `\;`, `\n`/`\N`
  - `splitStructured(v: string): string[]` / `joinStructured(parts: string[]): string` — split on unescaped `;`, components stay escaped

- [ ] **Step 1: Create fixture `tests/fixtures/appleV3.vcf`** (CRLF line endings):

```
BEGIN:VCARD
VERSION:3.0
PRODID:-//Apple Inc.//iPhone OS 17.0//EN
N:de Vries;Jan;;;
FN:Jan de Vries
ORG:Bakker\, Zonen;
TITLE:Baker
item1.TEL;type=CELL;type=VOICE;type=pref:06-12345678
item1.X-ABLabel:_$!<Mobile>!$_
TEL;type=WORK;type=VOICE:030-1234567
TEL;type=WORK;type=FAX:030-7654321
EMAIL;type=INTERNET;type=HOME;type=pref:jan@example.nl
EMAIL;type=INTERNET:jan2@example.nl
EMAIL;type=INTERNET;type=WORK:jan@bakker.nl
item2.URL;type=pref:https://jan.example.nl
item2.X-ABLabel:_$!<HomePage>!$_
ADR;type=HOME;type=pref:;;Dorpsstraat 1;Utrecht;;1234 AB;Nederland
ADR;type=WORK:;;Industrieweg 9\;unit 3;Utrecht;;3542 AA;
NOTE:Met at the market\nlikes rye
BDAY;X-APPLE-OMIT-YEAR=1604:1604-03-12
X-CREATED:2019-04-02T10:11:12Z
UID:1234ABCD-0000-4000-8000-000000000001
REV:2024-01-01T00:00:00Z
PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRgABAQEASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAA
 MAAAABAAEAAKACAAQAAAABAAAAAqADAAQAAAABAAAAAgAAAAD/7QA4UGhvdG9zaG9w
END:VCARD
```

- [ ] **Step 2: Write failing tests in `tests/friendly/lines.spec.ts`**
  - `parses groups, repeated types and params`: line for `item1.TEL...` has `group: 'item1'`, `name: 'TEL'`,
    `typesOf` = `['CELL','VOICE','PREF']`, `matchTypes` = `['CELL']`.
  - `keeps unknown properties`: names include `PRODID`, `X-CREATED`, `X-ABLABEL`, `REV`.
  - `unfolds folded lines`: PHOTO value has no CR/LF and starts with `/9j/` and ends with `aG9w`.
  - `round trips`: `parseCard(serializeCard(parseCard(fixture)))` deep-equals `parseCard(fixture)`, and every
    `serializeLine` of the parsed fixture appears verbatim (after unfolding) in the fixture text.
  - `unescapes and escapes text`: `unescapeText('Bakker\\, Zonen')` = `'Bakker, Zonen'`;
    `escapeText('a,b;c\nd\\')` = `'a\\,b\\;c\\nd\\\\'`;
    `splitStructured(';;Industrieweg 9\\;unit 3;Utrecht;;3542 AA;')[2]` = `'Industrieweg 9\\;unit 3'`.
  - `bare 2.1 params become TYPE`: `parseCard('BEGIN:VCARD\nTEL;CELL:1\nEND:VCARD')[0].params` = `[['TYPE','CELL']]`.
  - `quoted colon in param`: `X-FOO;LABEL="a:b":val` parses value `val`.
  - `folds long lines at 75 octets`: serialise a line with a 200-char value containing `é`; every physical line ≤ 75 bytes
    and unfolding restores the value.

- [ ] **Step 3: Run** `npx vitest run tests/friendly/lines.spec.ts` — Expected: FAIL (module missing).
- [ ] **Step 4: Implement `src/contacts/friendly/lines.ts`** with the interfaces above.
- [ ] **Step 5: Run** `npx vitest run tests/friendly/lines.spec.ts` — Expected: PASS.
- [ ] **Step 6: Commit** `git add src/contacts/friendly/lines.ts tests/friendly tests/fixtures/appleV3.vcf && git commit -m "feat(friendly): lossless vCard line model"`

---

### Task 2: Mapping table

**Files:**
- Create: `src/contacts/friendly/mapping.ts`, `tests/friendly/mapping.spec.ts`
- Modify: `src/settings/settings.d.ts`, `src/settings/setting.ts`

**Interfaces:**
- Consumes: `VCardLine`, `matchTypes` (Task 1)
- Produces:
  - `type Pattern = string` — `NAME` (no types after `matchTypes`) or `NAME[T1,T2]` (exact set after `matchTypes`, any order)
  - mapping row types:
    ```ts
    type FieldRow = { kind: 'field'; property: string; read: Pattern[]; write: string; format?: 'date' | 'list' }
    type ComponentRow = { kind: 'component'; property: string; read: Pattern[]; write: string; index: number }
    type RelationRow = { kind: 'relation'; property: string; types: string[]; write: string; mirror?: string; single?: boolean }
    type MappingRow = FieldRow | ComponentRow | RelationRow
    ```
    - `write` is the line prefix for new values, e.g. `TEL;TYPE=CELL`, `ADR;TYPE=HOME`, `RELATED;TYPE=child`.
    - `index` is the structured component: N = family 0, given 1, additional 2; ADR = street 2, city 3, region 4,
      postcode 5, country 6.
    - Relation `types` are lower-case.
  - `DEFAULT_MAPPING: MappingRow[]` — every row of the spec's "Default rows" and "Relationship rows", in that order.
    `categories` has `format: 'list'`; `birthday`/`anniversary` have `format: 'date'`; `spouse` has `single: true`.
  - `matchesPattern(line: VCardLine, pattern: Pattern): boolean`
  - `rowForLine(line: VCardLine, rows: MappingRow[]): MappingRow[]` — all component rows for a structured line, else at most one row
  - `rowForProperty(property: string, rows: MappingRow[]): { row: MappingRow; ordinal: number } | undefined` — strips `-2`, `-3` suffix to ordinal 2, 3
  - `isMappedProperty(property: string, rows: MappingRow[]): boolean`
  - `validateMapping(rows: MappingRow[]): string[]` — error messages; duplicate property, property equal to a vCard name, unparsable pattern
  - Settings: `ContactsPluginSettings.friendly: { mapping: MappingRow[]; mirrorRelations: boolean }`; default `{ mapping: DEFAULT_MAPPING, mirrorRelations: true }`;
    `initSettings` sets `mirrorRelations` to `false` on first load when `Platform.isMobile`.

- [ ] **Step 1: Write failing tests in `tests/friendly/mapping.spec.ts`**
  - `matches apple types`: fixture `item1.TEL...` -> row `mobile`; `EMAIL;type=INTERNET` -> `email`;
    `EMAIL;type=INTERNET;type=WORK` -> `work-email`; `TEL;type=WORK;type=FAX` -> none; `item2.URL;type=pref` -> `website`.
  - `structured rows`: `ADR;type=HOME;type=pref` -> rows `street, postcode, city, region, country`; `N` -> `firstname, middlename, lastname`.
  - `property ordinals`: `rowForProperty('mobile-2')` -> `{ row: mobile, ordinal: 2 }`; `rowForProperty('met-via')` -> undefined.
  - `relation rows`: `RELATED;TYPE=co-worker:urn:uuid:x` -> `colleagues`; `RELATED;TYPE=crush:...` -> none.
  - `validates`: duplicate `mobile` and property `TEL` both reported.
- [ ] **Step 2: Run** `npx vitest run tests/friendly/mapping.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `mapping.ts` and the settings defaults.
- [ ] **Step 4: Run** `npm run test:run` — Expected: PASS (existing settings tests still pass).
- [ ] **Step 5: Commit** `git commit -m "feat(friendly): mapping table and settings"` (add the touched files).

---

### Task 3: Lines -> friendly properties

**Files:**
- Create: `src/contacts/friendly/translate.ts`, `src/contacts/friendly/relations.ts` (types + link helpers only in this task), `tests/friendly/toFriendly.spec.ts`

**Interfaces:**
- Consumes: Tasks 1-2
- Produces:
  - `type FriendlyValue = string | string[]`
  - `type Provenance = { line: number; component?: number }`
  - `interface Friendly { props: Record<string, FriendlyValue>; source: Record<string, Provenance | Provenance[]> }` (array for list relations, one per item)
  - `interface RelationContext { uidToName(uid: string): string | undefined; resolveLink(name: string): { uid: string } | { text: string } | { ambiguous: true } }`
  - `toFriendly(lines: VCardLine[], rows: MappingRow[], ctx: RelationContext): Friendly`
  - In `relations.ts`: `toLink(name: string): string` -> `[[name]]`; `linkTarget(value: string): string` (strips `[[`, `]]`, `|alias`, `#heading`; plain text passes through)

Rules (spec "Matching", "Multiple values", "Server -> note"):
- Text values unescaped.
- Dates: `YYYYMMDD` -> `YYYY-MM-DD`; anything else as-is.
- `categories`: unescaped comma split.
- First match of a row is `property`, next `property-2`, ...
- Component rows: only the first matching line feeds them; later lines of that row are not shown.
- Empty values produce no property.
- `RELATED` value `urn:uuid:<u>`:
  - `ctx.uidToName(u)` is known: `[[name]]`
  - unknown: no property
- `RELATED;VALUE=text:<t>`: `[[t]]`.

- [ ] **Step 1: Write failing tests** (ctx stub: `uidToName` returns `'Anna de Vries'` for `anna-uid`, else undefined)
  - `maps the apple fixture`:
    - `props` equals:
      ```ts
      {
        name: 'Jan de Vries', firstname: 'Jan', lastname: 'de Vries', company: 'Bakker, Zonen', title: 'Baker',
        mobile: '06-12345678', 'work-phone': '030-1234567', email: 'jan@example.nl', 'email-2': 'jan2@example.nl',
        'work-email': 'jan@bakker.nl', website: 'https://jan.example.nl', street: 'Dorpsstraat 1', city: 'Utrecht',
        postcode: '1234 AB', country: 'Nederland', 'work-street': 'Industrieweg 9;unit 3', 'work-city': 'Utrecht',
        'work-postcode': '3542 AA', note: 'Met at the market\nlikes rye', birthday: '1604-03-12',
        uid: '1234ABCD-0000-4000-8000-000000000001', photo: <the unfolded PHOTO value>
      }
      ```
    - No `X-CREATED`, `REV`, fax or label keys.
  - `keeps apple year-less birthday`: `birthday` = `'1604-03-12'`; `BDAY:--0312` gives `'--0312'`.
  - `relations`:
    - `RELATED;TYPE=spouse:urn:uuid:anna-uid` -> `spouse: '[[Anna de Vries]]'`
    - two `RELATED;TYPE=child;VALUE=text:...` -> `children: ['[[Sem]]','[[Lotte]]']`
    - unknown uid -> no property
  - `provenance`: `source.mobile` = `{ line: <index of item1.TEL> }`; `source.city` = `{ line: <ADR home index>, component: 3 }`.
  - `linkTarget`: `'[[Anna de Vries|Anna]]'` -> `'Anna de Vries'`; `'Anna'` -> `'Anna'`.
- [ ] **Step 2: Run** `npx vitest run tests/friendly/toFriendly.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `toFriendly`, `toLink`, `linkTarget`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(friendly): translate vCard lines to friendly properties"`.

---

### Task 4: Friendly properties -> patched lines

**Files:**
- Modify: `src/contacts/friendly/translate.ts`
- Create: `tests/friendly/patch.spec.ts`

**Interfaces:**
- Produces:
  - `patch(base: VCardLine[], before: Friendly, after: Record<string, FriendlyValue>, rows: MappingRow[], ctx: RelationContext): { lines: VCardLine[]; warnings: string[] }`
  - `newCard(props: Record<string, FriendlyValue>, rows: MappingRow[], ctx: RelationContext): VCardLine[]` = `patch` on
    `[VERSION:4.0]` with an empty `before`; adds `UID:urn:uuid:<generateUUID()>` when `uid` is missing, and `FN` from
    `firstname lastname` when `name` is missing.

Rules:
- Only properties where `isMappedProperty` is true are considered.
- Value equal to `before.props` (after string coercion): the line is untouched.
- Changed: rewrite the value (or only that component) on the provenance line, keep group/params, escape text.
- Removed or emptied:
  - single-value line: delete it, and also delete an `X-ABLABEL` line with the same group;
  - component: set it empty; delete the whole line if all its components are empty, except `N`.
- Added: append `<row.write>:<escaped value>`; structured adds build one new line with all components of that row group.
- Relations compare by `linkTarget`:
  - removed items delete their own line;
  - added items append `RELATED;TYPE=<t>:` with:
    - `urn:uuid:<uid>` when `ctx.resolveLink` gives a uid;
    - `;VALUE=text:` plus the text when it gives text;
    - `;VALUE=text:` plus the text when ambiguous, and push a warning containing the name.
- If anything changed and a `REV` line exists, set it to the current UTC time `YYYYMMDDTHHMMSSZ`.

- [ ] **Step 1: Write failing tests** (base = `parseCard(appleV3)`, `before = toFriendly(base)`)
  - `no changes returns identical lines`: `patch(base, before, before.props)` deep-equals `base`.
  - `untouched birthday line is identical`: change `mobile` only; BDAY line object unchanged.
  - `edit keeps group and params`: `mobile: '06-99999999'` -> line `item1.TEL;type=CELL;type=VOICE;type=pref:06-99999999`.
  - `re-escapes edited values`: `company: 'Smit, Zn'` -> value `Smit\, Zn;` (second ORG component preserved).
  - `delete removes line and its label`: remove `website` -> no `item2.URL` and no `item2.X-ABLabel`.
  - `delete component`: `work-street: ''` keeps the work ADR with component 2 empty.
  - `add uses write key`: add `mobile-2: '06-1'` -> appended `TEL;TYPE=CELL:06-1`.
  - `add address`: add `work-city` on a card without work ADR -> `ADR;TYPE=WORK:;;;Amersfoort;;;`.
  - `relations add/remove`: ctx resolves `Sem` to uid `sem-uid`, `Opa` to text, `Jan` ambiguous.
    Adding `children: ['[[Sem]]','[[Opa]]','[[Jan]]']` appends
    `RELATED;TYPE=child:urn:uuid:sem-uid`, `RELATED;TYPE=child;VALUE=text:Opa`, `RELATED;TYPE=child;VALUE=text:Jan`
    and warnings has one entry containing `Jan`.
  - `local-only properties are ignored`: `after` with `met-via: '[[Piet]]'` adds no line.
  - `newCard`: `{ firstname: 'Anna', lastname: 'Smit', mobile: '06' }` -> has `VERSION:4.0`, `UID:urn:uuid:`, `FN:Anna Smit`, `N:Smit;Anna;;;`, `TEL;TYPE=CELL:06`.
- [ ] **Step 2: Run** `npx vitest run tests/friendly/patch.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `patch` and `newCard`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(friendly): patch vCard lines from friendly properties"`.

---

### Task 5: Three-way merge and note value coercion

**Files:**
- Create: `src/contacts/friendly/merge.ts`, `tests/friendly/merge.spec.ts`

**Interfaces:**
- Produces:
  - `coerceNoteProps(frontmatter: Record<string, unknown>, rows: MappingRow[]): { props: Record<string, FriendlyValue>; warnings: string[] }`
    - keeps only mapped properties;
    - converts `number` and `boolean` with `String`, and `Date` to `YYYY-MM-DD`;
    - drops `null`/`''`;
    - a list in a text property takes the first item and adds a warning naming the property;
    - text in a list property becomes a one-item list.
  - `interface Conflict { property: string; local: FriendlyValue; server: FriendlyValue }`
  - `mergeFriendly(base: Record<string, FriendlyValue> | undefined, server: Record<string, FriendlyValue>, local: Record<string, FriendlyValue>): { merged: Record<string, FriendlyValue>; conflicts: Conflict[] }`
    - per property in the union, by the spec's Sync step 3 (absent = `undefined`);
    - without a base, every property where local differs from server is a conflict, and the server wins;
    - list values compare as sets of `linkTarget`.
- `renderConflictCallout(conflicts: Conflict[], when: Date): string` — markdown appended to the note body:
  ```
  > [!warning] Sync conflict 2026-10-17 14:03
  > The server value was kept. Your value was:
  > - mobile: 06-1111
  ```

- [ ] **Step 1: Write failing tests**
  - `server-only change wins`: base `{mobile:'1'}`, server `{mobile:'2'}`, local `{mobile:'1'}` -> merged `mobile:'2'`, no conflicts.
  - `local-only change wins`: base `{mobile:'1'}`, server `{mobile:'1'}`, local `{mobile:'3'}` -> `'3'`.
  - `server deletion`: base `{email:'a'}`, server `{}`, local `{email:'a'}` -> no `email`.
  - `local deletion`: base `{email:'a'}`, server `{email:'a'}`, local `{}` -> no `email`.
  - `conflict keeps server`: base `{mobile:'1'}`, server `{mobile:'2'}`, local `{mobile:'3'}` -> `'2'`, conflicts `[{property:'mobile', local:'3', server:'2'}]`.
  - `no base`: server `{mobile:'2', email:'x'}`, local `{mobile:'3', company:'C'}` -> `{mobile:'2', email:'x', company:'C'}`, one conflict (mobile).
  - `relation lists compare as sets`: base `children: ['[[A]]','[[B]]']`, local reordered `['[[B]]','[[A|Aa]]']` -> no change.
  - `coerces yaml values from the note`: `{mobile: 612345678, birthday: new Date('1975-03-12'), email: ['a','b'], spouse: null, 'met-via': 'x'}`
    -> props `{mobile:'612345678', birthday:'1975-03-12', email:'a'}`, warnings has one entry containing `email`.
- [ ] **Step 2: Run** `npx vitest run tests/friendly/merge.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(friendly): three-way merge of contact properties"`.

---

### Task 6: Relationship diff and mirror planning

**Files:**
- Modify: `src/contacts/friendly/relations.ts`
- Create: `tests/friendly/relations.spec.ts`

**Interfaces:**
- Produces:
  - `type RelationSnapshot = Record<string, string[]>` — relation property -> sorted `linkTarget`s
  - `relationSnapshot(props: Record<string, unknown>, rows: MappingRow[]): RelationSnapshot`
  - `inverseProperty(property: string, rows: MappingRow[]): string | undefined` — via `mirror`
  - `interface MirrorWrite { targetPath: string; property: string; link: string; op: 'add' | 'remove' }`
  - `planMirrorWrites(sourcePath: string, sourceName: string, before: RelationSnapshot, after: RelationSnapshot, resolve: (target: string) => { path: string; snapshot: RelationSnapshot } | undefined, rows: MappingRow[]): MirrorWrite[]`
    - added: an `add` of `[[sourceName]]` under the inverse property, unless already present;
    - removed: a `remove` only if the target's inverse list contains `sourceName`;
    - no inverse, or the target does not resolve: nothing.
  - `findOneSided(all: { path: string; name: string; snapshot: RelationSnapshot }[], rows): { path: string; property: string; target: string }[]`
- Remote name resolution used by `ObsidianRelationContext` (Task 9): `resolveRemoteName(name: string, remote: { uid: string; fileName: string }[]): { uid: string } | { text: string } | { ambiguous: true }` — exact match on `fileName`.

- [ ] **Step 1: Write failing tests**
  - `child adds parent`: Jan before `{}` after `{children:['Sem']}`, Sem resolves with `{}` -> `[{targetPath:'Sem.md', property:'parents', link:'[[Jan]]', op:'add'}]`.
  - `already mirrored is a no-op`: Sem has `parents:['Jan']` -> `[]`.
  - `remove only when pointing back`: Jan removes spouse Anna; Anna has `spouse:['Piet']` -> `[]`; Anna has `spouse:['Jan']` -> remove.
  - `emergency has no mirror`: `[]`.
  - `findOneSided`: Jan `children:['Sem']`, Sem `{}` -> one entry `{path:'Jan.md', property:'children', target:'Sem'}`.
  - `ambiguous remote name resolves to text`: `resolveRemoteName('Jan de Vries', [{uid:'1',fileName:'Jan de Vries'},{uid:'2',fileName:'Jan de Vries'}])` -> `{ambiguous:true}`; no match -> `{text:'Jan de Vries'}`.
- [ ] **Step 2: Run** `npx vitest run tests/friendly/relations.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(friendly): relationship diff and mirror planning"`.

---

### Task 7: Sync state store and adapter changes

**Files:**
- Create: `src/sync/syncState.ts`, `tests/syncState.spec.ts`
- Modify: `src/sync/adapters/carddavGeneric.ts`, `src/sync/adapters/adapter.d.ts`, `src/sync/adapters/adapterInterface.ts`, `tests/sync.spec.ts` (if signatures change)

**Interfaces:**
- Produces:
  - `interface FileStore { read(path: string): Promise<string | undefined>; write(path: string, data: string): Promise<void>; remove(path: string): Promise<void> }`
  - `createSyncState(store: FileStore, dir: string): SyncState`
  - `interface SyncState { get(uid: string): Promise<{ raw: string; etag: string; href: string } | undefined>; set(uid: string, entry: { raw: string; etag: string; href: string }): Promise<void>; remove(uid: string): Promise<void> }`
    - storage: `<dir>/<cleanUid>.vcf` holds raw, `<dir>/index.json` holds `{ [uid]: { etag, href } }`
  - `obsidianFileStore(app: App): FileStore` (in the same file, using `app.vault.adapter`; the only Obsidian import there)
  - Adapter:
    - `VCardRaw` gains `etag?: string; href?: string`
    - `pull(href)` fills `etag` from the `etag` response header (quotes stripped) and `href`
    - `push(vcard: VCardRaw, opts?: { href?: string; ifMatch?: string; ifNoneMatch?: boolean })` PUTs to `opts.href`
      resolved against the address book URL, else `<addressBookUrl>/<uid>.vcf`. It sends `If-Match: "<etag>"` or
      `If-None-Match: *`, and returns the response including `status` and the `etag` header.
    - `VCardMeta` gains `n: string | undefined`; the REPORT asks `<C:prop name="N"/>` and `getMetaList` fills it.

- [ ] **Step 1: Write failing tests**
  - `tests/syncState.spec.ts` with an in-memory `FileStore`:
    - `set then get returns entry`
    - `uid with urn:uuid prefix uses clean file name` (file `<dir>/abc.vcf` for `urn:uuid:abc`)
    - `remove deletes both`
  - Extend `tests/platformHttpClient.spec.ts` style (local server) in `tests/carddavAdapter.spec.ts`:
    - `push uses href and If-Match`: settings URL `http://127.0.0.1:<port>/frank/contacts/`, push with
      `{href:'/frank/contacts/ABC.vcf', ifMatch:'e1'}` -> server sees path `/frank/contacts/ABC.vcf` and header `if-match: "e1"`
    - `pull returns etag`: server replies header `ETag: "e2"` -> `etag === 'e2'`
    - The adapter reads settings via `getSettings`; mock `src/context/sharedSettingsContext` as `tests/vcard.spec.ts` does.
- [ ] **Step 2: Run** `npx vitest run tests/syncState.spec.ts tests/carddavAdapter.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run test:run` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(sync): sync state store, etag and href aware adapter"`.

---

### Task 8: The Sync operation

**Files:**
- Create: `src/sync/syncContact.ts`, `tests/syncContact.spec.ts`
- Modify: `src/sync/index.ts`, `src/sync/sync.ts`, `src/ui/sidebar/components/ContactView.tsx:166-189`

**Interfaces:**
- Consumes: Tasks 1-7
- Produces:
  ```ts
  interface NoteIO {
    readFrontmatter(): Promise<Record<string, unknown>>;
    writeProps(set: Record<string, FriendlyValue>, remove: string[]): Promise<void>;
    appendToBody(markdown: string): Promise<void>;
  }
  interface SyncDeps { adapter: AdapterInterface; state: SyncState; rows: MappingRow[]; ctx: RelationContext; notify(msg: string): void; now(): Date }
  type SyncOutcome = 'unchanged' | 'pulled' | 'pushed' | 'both' | 'created' | 'failed'
  syncContact(note: NoteIO, deps: SyncDeps): Promise<SyncOutcome>
  ```
  - `sync.syncContact(contact: Contact)` in `src/sync/sync.ts` builds real deps (Task 9 provides `noteIO(file)` and
    `ObsidianRelationContext`) and calls it.

Algorithm (spec "Sync operation"):
1. Local is `coerceNoteProps(frontmatter)`. Its `uid` decides the server lookup through `getMetaByUid`.
   - No `uid`: assign one (`urn:uuid:` + `generateUUID()`), write it to the note, and treat it as a new contact.
2. Server card found: pull it with its etag. Base is `state.get(uid)`.
   - `F(S) = toFriendly(parseCard(S.raw))`
   - `F(B) = toFriendly(parseCard(B.raw))` when there is a base
3. Merge:
   - run `mergeFriendly(F(B)?.props, F(S).props, local)`;
   - write the merged values to the note: the set of changed properties, plus a remove list for mapped properties
     no longer present;
   - for conflicts, call `appendToBody(renderConflictCallout(...))` and `notify`.
4. Patch and push:
   - `patch(parseCard(S.raw), F(S), merged)`;
   - if the serialized result differs from `S.raw` lines, call `push` with `href` = meta href and `ifMatch` = etag;
   - on a 412 response, restart once from step 2; a second 412 gives `failed` and a notify.
5. No server card: `newCard(local)`, then `push` with `ifNoneMatch: true`; outcome `created`.
6. After every non-failed outcome, `state.set(uid, { raw: <card as now on server>, etag: <response etag or pulled etag>, href })`.
   - If the PUT response has no etag, pull again to get the stored raw and etag.

UI:
- In `ContactView.tsx`, replace the menu items "Push" and "Pull" with one item, "Sync" (icon `refresh-cw`), which
  calls `sync.syncContact`.
- Keep "Delete"; it also calls `state.remove(uid)`.
- Remove `pushToRemote` and `updateFromRemote` from `src/sync/sync.ts` and `src/sync/index.ts`.
- Remove the matching tests in `tests/sync.spec.ts`; their behaviour is replaced by `tests/syncContact.spec.ts`.

- [ ] **Step 1: Write failing tests** with a fake adapter (in-memory cards keyed by href, etags incrementing) and in-memory `NoteIO`:
  - `server-only change is pulled`: base = server v1; server v2 changes mobile; note unchanged -> note mobile updated, no PUT, outcome `pulled`.
  - `local-only change is pushed with If-Match`: note changes email -> one PUT with `ifMatch` = current etag; server
    card still contains `X-CREATED`, `item1.X-ABLabel`, fax line byte-identical; outcome `pushed`.
  - `puts to the existing href, not uid.vcf`: meta href `/frank/contacts/ABC-DEF.vcf`, uid `1234...` -> PUT href is `/frank/contacts/ABC-DEF.vcf`.
  - `conflict keeps server and appends callout`: outcome `both` or `pulled`; `appendToBody` called once with text containing `mobile`.
  - `412 retries once`: fake returns 412 on first PUT -> second attempt succeeds; two 412s -> `failed`.
  - `no base merges server-first`: no state entry -> no data removed on the server, local-only extra field pushed.
  - `new contact is created`: no server card -> PUT with `ifNoneMatch`, outcome `created`, state stored.
  - `local-only properties never reach the server`: note has `met-via` -> pushed card has no `MET-VIA` line.
  - `body is never sent`: `NoteIO` body text not present in any pushed card.
- [ ] **Step 2: Run** `npx vitest run tests/syncContact.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement `syncContact` and the UI change.**
- [ ] **Step 4: Run** `npm run test:run && npm run build` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(sync): one lossless Sync action per contact"`.

---

### Task 9: Obsidian boundary for notes

**Files:**
- Create: `src/contacts/friendlyNotes.ts`, `tests/friendlyNotes.spec.ts`
- Modify:
  - `src/contacts/contactFrontmatter.ts` (`getFrontmatterFromFiles`, `updateFrontMatterValue`)
  - `src/contacts/contactMdTemplate.ts` (`mdRender`)
  - `src/contacts/vcard/toString.ts` (`generateVCard`)
  - `src/contacts/vcard/createEmpty.ts`, `src/contacts/vcard/addDefaultFields.ts`
  - `src/ui/sidebar/components/SidebarRootView.tsx:30-52`
  - `src/insights/processors/SyncUnknownProcessor.tsx:13-30`
  - `src/insights/processors/UidProcessor.tsx`
  - `src/util/avatarActions.ts`
  - `src/settings/setting.ts`
  - `src/sync/sync.ts` (`getUnknownFromRemote`)

**Interfaces:**
- Consumes: Tasks 1-8
- Produces:
  - `legacyRecord(frontmatter: Record<string, unknown>, rows: MappingRow[]): VCardForObsidianRecord`
    - Old-style notes: keys that parse as vCard keys pass through unchanged.
    - Friendly notes: `newCard(coerceNoteProps(...).props)`, run through the existing `vcard.parse(serializeCard(...))`
      to get the record.
  - `isContactFrontmatter(fm): boolean` — `name`, `firstname`, `lastname`, `FN`, or `N.GN` + `N.FN`
  - `renderFriendlyNote(props: Record<string, FriendlyValue>, hashtags: string): string`
    - frontmatter in mapping-row order, then `uid` last;
    - body is an empty line plus hashtags (no `#### Notes`).
  - `noteIO(app: App, file: TFile): NoteIO` — `processFrontMatter` for `writeProps`, `vault.process` for `appendToBody`
  - `class ObsidianRelationContext implements RelationContext`
    - built from the contact notes (uid -> basename) and the remote meta list (uid -> import file name via `createNameSlug`, using `n` and `fn`)
    - `resolveLink`:
      - `metadataCache.getFirstLinkpathDest` gives a contact note with `uid`: that note's uid;
      - otherwise `resolveRemoteName`.
  - `friendlyKey(vcardKey: string, rows: MappingRow[]): string` — for `UID`, `PHOTO`, `FN` callers of `updateFrontMatterValue`
- Changes:
  - **Old functions keep their signatures.**
    - `getFrontmatterFromFiles` returns `legacyRecord`.
    - `updateFrontMatterValue` translates the key and uses `processFrontMatter`.
    - `generateVCard` uses the stored base patched with the note when it exists, else `newCard`.
  - **Import paths:**
    - Both `importVCFContacts` and `ImportUnknownVcardToVault` parse each card with `parseCard`.
    - They render with `renderFriendlyNote(toFriendly(...).props)`.
    - For remote imports they `state.set(uid, …)` with the pulled raw/etag/href.
    - Multi-card `.vcf` files are split on `BEGIN:VCARD`.
  - **`createFieldsKeys`:**
    - Default becomes `firstname, lastname, mobile, phone, work-phone, email, work-email, birthday, street, city, postcode, country, website, company, title, categories`.
    - `initSettings` replaces a stored value that equals the old default list with the new list.
  - **`getUnknownFromRemote`:** keep the matching (UID or FN), reading `uid`/`name` through `legacyRecord`.

- [ ] **Step 1: Write failing tests**
  - `legacy record from friendly note`:
    `{name:'Jan de Vries', firstname:'Jan', lastname:'de Vries', mobile:'06', city:'Utrecht'}` gives a record with
    `FN`, `N.GN`, `N.FN`, `TEL[CELL]` = `'06'`, `ADR[HOME].LOCALITY` = `'Utrecht'`.
  - `old-style note passes through`: `{FN:'X', 'TEL[CELL]':'1'}` -> same keys.
  - `renders friendly note`:
    - the apple fixture props render YAML starting with `name:` and ending with `uid:` before `---`;
    - the body contains the hashtag;
    - the output does not contain `#### Notes`.
  - `phone numbers stay strings`: rendering `mobile: '0612345678'` produces `mobile: "0612345678"` (quoted).
- [ ] **Step 2: Run** `npx vitest run tests/friendlyNotes.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement and switch the callers listed above.**
- [ ] **Step 4: Run** `npm run test:run && npm run build` — Expected: PASS.
  - Update `tests/vcard.spec.ts` expectations only where they test `mdRender` output format.
  - Parser expectations stay.
- [ ] **Step 5: Commit** `git commit -m "feat(friendly): read and write contact notes with friendly properties"`.

---

### Task 10: Relationship mirroring in Obsidian

**Files:**
- Create: `src/contacts/relationMirror.ts`, `tests/relationMirror.spec.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: Task 6 (`relationSnapshot`, `planMirrorWrites`), Task 9 (`isContactFrontmatter`)
- Produces:
  ```ts
  interface MirrorEnv {
    listContacts(): { path: string; name: string; frontmatter: Record<string, unknown> }[];
    resolveLink(name: string, fromPath: string): string | undefined;
    apply(write: MirrorWrite): Promise<void>;
  }
  class RelationMirror {
    constructor(env: MirrorEnv, rows: () => MappingRow[]);
    init(): void;
    onChanged(path: string, frontmatter: Record<string, unknown>): Promise<void>;
    onCreated(path: string): Promise<void>;
    onRenamed(oldPath: string, newPath: string): void;
  }
  ```
  - `resolveLink` wraps `getFirstLinkpathDest`.
  - `apply` uses `processFrontMatter`: ensure present / ensure absent in the list, or the text for `spouse`.
  - `init()` builds the snapshot.
  - `onChanged`:
    - diff against the snapshot, then `planMirrorWrites`, then `apply` each write;
    - update the snapshot for the source and every target before applying, so the echo `changed` event diffs to nothing.
  - `onCreated`: add the inverses of other notes' relationships pointing to the new note's name; mirror its own.
  - `main.ts`:
    - when `settings.friendly.mirrorRelations`, register `metadataCache.on('changed')`, `vault.on('create')` and `vault.on('rename')`;
    - only for files in the contacts folder;
    - wait for `metadataCache.on('resolved')` once before `init()`.

- [ ] **Step 1: Write failing tests** with an in-memory `MirrorEnv`:
  - `adds inverse on change`: Jan gets `children: ['[[Sem]]']` -> Sem gets `parents: ['[[Jan]]']`.
  - `echo does not loop`: applying the write and then calling `onChanged` for Sem with the new frontmatter produces no further writes.
  - `removal mirrors only when pointing back`.
  - `new note picks up existing relationships`: Jan has `spouse: '[[Anna]]'`; `onCreated('Anna.md')` -> Anna gets `spouse: '[[Jan]]'`.
  - `mirrors to the resolved note only`: two notes `People/Jan.md` and `Old/Jan.md`; link resolves to `People/Jan.md` -> only that one is written.
- [ ] **Step 2: Run** `npx vitest run tests/relationMirror.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement and wire in `main.ts`.**
- [ ] **Step 4: Run** `npm run test:run && npm run build` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(friendly): mirror relationships between contact notes"`.

---

### Task 11: Commands and settings UI

**Files:**
- Create: `src/ui/settings/components/propertyNamesSettings.tsx`, `src/ui/modals/checkRelationsModal.ts`, `src/contacts/convertNotes.ts`, `tests/convertNotes.spec.ts`
- Modify: `src/main.ts`, `src/ui/settings/settingsView.tsx`, `styles.css`

**Interfaces:**
- Produces:
  - `convertFrontmatter(fm: Record<string, unknown>, rows: MappingRow[]): { set: Record<string, FriendlyValue>; remove: string[] }`
    - from an old-style note;
    - vCard keys: `vcard.parse`-style record, then lines, then `toFriendly`;
    - keys that are not vCard keys are kept;
    - the body is untouched.
  - Commands, registered in `main.ts`:
    - `vcf-friendly-convert` "Convert contacts to friendly properties": all contact notes; Notice with the count.
    - `vcf-friendly-check-relations` "Check relationships": `findOneSided`, then a modal listing items, each with
      buttons "Add the other side" / "Remove".
  - Settings section "Property names":
    - a row per mapping entry: friendly name text input; read patterns as a comma-separated input; write key input;
    - "Reset to defaults" button;
    - errors from `validateMapping` shown inline, and an invalid mapping is not saved;
    - toggle "Mirror relationships on this device", described as "Keeps both sides of a relationship in sync, e.g. children and parents.";
    - renaming a friendly name shows a Notice offering the convert command.

- [ ] **Step 1: Write failing tests** for `convertFrontmatter`:
  - `{FN:'Jan', 'N.GN':'Jan', 'N.FN':'de Vries', 'TEL[CELL]':'06', 'met-via':'[[Piet]]'}` gives:
    - `set` = `{ name:'Jan', firstname:'Jan', lastname:'de Vries', mobile:'06' }`
    - `remove` contains `FN`, `N.GN`, `N.FN`, `TEL[CELL]`
    - `met-via` is not in `remove`
  - `idempotent`: converting an already-friendly note gives empty `set` and `remove`.
- [ ] **Step 2: Run** `npx vitest run tests/convertNotes.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement**, including the UI. Style the table in `styles.css` with a `vcf-` prefix.
- [ ] **Step 4: Run** `npm run test:run && npm run build` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(friendly): convert and check commands, property names settings"`.

---

### Task 12: End-to-end check against Radicale and release build

**Files:**
- Create: `tests/scripts/radicale-e2e.md` (manual checklist with exact commands)

- [ ] **Step 1: Start a local Radicale 3.8.3.** Use the existing `/tmp/radtest` venv, or recreate it with
  `python3 -m venv /tmp/radtest/venv && /tmp/radtest/venv/bin/pip install radicale==3.8.3`.
  - Port 5299.
  - Auth `htpasswd` (plain).
  - Load `tests/fixtures/appleV3.vcf` as `/frank/contacts/ABC-DEF.vcf` with `curl -T`.
- [ ] **Step 2: Install the build into a scratch vault**
  - Copy `main.js`, `manifest.json` and `styles.css` to `<vault>/.obsidian/plugins/vcf-contacts-friendly/`.
  - Configure sync to the local server.
- [ ] **Step 3: Run the checklist.** For each step, record the server card (`curl -u frank:… …/ABC-DEF.vcf`):
  1. Import from the insights panel: the note looks like the spec example, and `sync-state` holds the card.
  2. Edit `mobile`, then Sync: only the TEL value changed on the server, every other line is byte-identical, and there
     is still exactly one card.
  3. Edit the card on the server (`curl -T`), then Sync: the note is updated.
  4. Edit the same field on both sides, then Sync: the server value is kept, and the callout and Notice are shown.
  5. Add `children: [[Sem]]`:
     - Sem's note (if it exists) gets `parents`;
     - after Sync, the server has a `RELATED;TYPE=child` line.
  6. Add `met-via: [[Piet]]`, then Sync: no `MET-VIA` line on the server.
- [ ] **Step 4: Bump to `3.0.0-alpha.1`, then build.**
  - Run: `npm run build`. Expected: success.
  - Commit `git commit -am "chore: release 3.0.0-alpha.1"`.
- [ ] **Step 5: Ask the owner before publishing anything.**
  - Ask before creating a GitHub release on the fork.
  - Ask before opening a PR.

---

## Spec coverage check

| Spec section | Task |
|---|---|
| Readable properties, default rows, numbering, list/text rules | 2, 3, 4, 5 |
| Current data loss (groups, repeated TYPE, params, PRODID/RELATED, push wipes) | 1, 4, 7, 8 |
| Base, no-base merge, Sync operation, If-Match/412 | 5, 7, 8 |
| Translator plug-in points, old notes, convert command | 9, 11 |
| Local-only properties never pushed | 4, 8 |
| Settings UI (mapping table) | 11 |
| RELATED both directions, remote name lookup with N | 3, 4, 6, 7, 9 |
| Mirroring, echo guard, device toggle, no reconcile, Check relationships | 2, 6, 10, 11 |
| Testing section incl. manual Radicale run | every task, 12 |
| Toggle "Friendly properties" | dropped (Global Constraints) |
