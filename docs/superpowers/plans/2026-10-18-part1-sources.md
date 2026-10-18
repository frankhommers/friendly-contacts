# Part 1: Address Book Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Several CardDAV address books ("sources"), each with its own URL and credentials; every contact note belongs to
exactly one, named in its `source:` property.

**Architecture:**
- Pure source logic in `src/sync/sources.ts`: settings migration, name validation, which source a note belongs to,
  and what to do given where the card was found.
- The CardDAV adapter is bound to one source (`carddavAdapter(source)`) instead of reading global settings.
- Sync bases live per source (`sync-state/<source id>/`).
- Sync (`src/sync/sync.ts`) picks the source per note, searches every source for the UID before creating a card, and
  moves a card between sources when the note's `source:` changed.
- Import and the import insight cover all sources.

This part keeps today's merge behaviour (conflict callout). Part 2 replaces the merge with the review screen.

**Tech Stack:** TypeScript, Obsidian API, React 18 settings UI, vitest, Radicale 3.8.3 for e2e.

**Spec:** `docs/superpowers/specs/2026-10-18-sources-review-folders-design.md`, Part 1 and "Fixes carried over".

## Global Constraints

- Commits: never add `Co-Authored-By` or mention any LLM/agent.
- HTTP only through `PlatformHttpClient`; never `fetch`.
- Business logic outside `.tsx`; UI only calls core modules.
- Modules under `src/contacts/friendly/` and `src/sync/sources.ts` import nothing from `obsidian` or `src/context/*`.
- Test: `npm run test:run`. Build: `npm run build`. Both pass at the end of every task. e2e: `npm run test:e2e`.
- Never display or log a stored secret (`authKey`); the UI shows only "Connected as <user>" / "Connected with API key".
- `source` is a fixed note property: never sent to the card, not in the mapping table, not renameable, not usable as a
  mapping property name.
- A card is never written to a source other than the one decided below, and a second copy is never created.

## Rulings made while planning (spec silent or Part-ordering)

- Ruling: `syncEnabled` / `syncSelected` are replaced by `enabled` per source — the spec gives each source today's
  credentials UX, which includes Enable/Disable — cost if wrong: one settings flag to reintroduce.
- Ruling: on mobile, sources are unavailable at runtime but their settings are not changed (today mobile writes
  `syncEnabled: false`, which vault sync carries to the desktop) — cost if wrong: none for desktop users.
- Ruling: until Part 2 exists, a source move is confirmed with the existing `ConfirmModal` ("Move Jan de Vries from
  Private to Family?"); Part 2 replaces it with the review-screen line — cost if wrong: a modal that lives one part.
- Ruling: in this part, a move first runs the normal Sync against the old source, then moves the resulting card — the
  card written to the new source is the merged card; Part 2 makes it the reviewed result — cost if wrong: none, the
  merge is today's behaviour.

## Review Focus

1. **The note's `source:` names a source that is disabled or missing** → refuse ("Unknown address book 'X'" /
   "Address book 'X' is not enabled"), never fall back. Test: Task 4 `unknown or disabled source refuses`.
2. **Same UID in two sources, no note** → both offered for import; after importing one, the other is not offered.
   Remote name resolution must not call the same person ambiguous just because both books hold the same card with the
   same name. Test: Task 5 `same uid same name in two sources is not ambiguous`.
3. **Migration run twice / data.json already migrated** → no second source, no lost credentials, sync-state not moved
   twice. Test: Task 1 `migration is idempotent`, Task 3 `moves old sync state once`.
4. **Renaming a source while a note is open and edited** → the rewrite goes through `processFrontMatter` per note;
   a failing note is reported and the others still renamed; the source name in settings changes only after the notes.
   Test: Task 7 `rename reports failed notes`.
5. **Move where the delete of the old card fails (412)** → the card stays in both, note keeps the new source, a Notice
   says so, base moved to the new source, no retry. Test: Task 4 `move with failed delete keeps both`.

---

### Task 1: Source settings and migration

**Files:**
- Create: `src/sync/sources.ts`
- Modify: `src/settings/settings.d.ts`, `src/settings/setting.ts` (`DEFAULT_SETTINGS`),
  `src/context/sharedSettingsContext.ts` (`initSettings`), `src/contacts/friendly/mapping.ts` (`validateMapping`)
- Test: `tests/sources.spec.ts` (new), `tests/context.spec.ts`, `tests/friendly/mapping.spec.ts`

**Interfaces:**
- Produces (`settings.d.ts`):
  ```ts
  export interface Source {
    id: string; name: string; addressBookUrl: string; authType: AuthType; authKey: string; enabled: boolean;
  }
  ```
  `ContactsPluginSettings` gains `sources: Source[]` and `defaultSource: string` (a source id, `''` when none) and loses
  `CardDAV`, `syncSelected` and `syncEnabled`. `SyncSelected` and `CardDavSyncSettings` are removed.
- Produces (`sources.ts`):
  - `migrateSources(loaded: Record<string, unknown>, newId: () => string): { sources: Source[]; defaultSource: string; migratedFrom?: string }`
    — `loaded.sources` (array) wins and is returned as is (with `defaultSource` from `loaded`, or the first id).
    Otherwise a `loaded.CardDAV` with a non-empty `addressBookUrl` becomes one source: name
    `sourceNameFromUrl(url)`, `enabled = loaded.syncEnabled === true && loaded.syncSelected === 'CardDAV'`, auth copied,
    made default; `migratedFrom` is set to its id (Task 3 moves the sync state when present). Otherwise empty.
  - `sourceNameFromUrl(url: string): string` — last non-empty path segment, URI-decoded; `'Contacts'` when none.
  - `validateSourceName(name: string, sources: Source[], selfId?: string): string | undefined` — error text for empty
    (after trim) or a case-insensitive duplicate of another source.
  - `findSourceByName(sources: Source[], name: string): Source | undefined` — case-insensitive, trimmed.
- `initSettings` calls `migrateSources(loaded, generateUUID)` and drops `CardDAV`, `syncSelected`, `syncEnabled` from
  what it saves. `validateMapping` reports a row whose property is `source` ("`source` is reserved for the address
  book.").

- [ ] **Step 1: Write the failing tests** in `tests/sources.spec.ts`:
  - `migrates the single CardDAV block`: `{ syncEnabled: true, syncSelected: 'CardDAV', CardDAV: { addressBookUrl:
    'https://pim.example/frank/contacts/', authType: 'basic', authKey: 'k', syncInterval: 900 } }` with `newId = () => 'id1'`
    → `sources: [{ id: 'id1', name: 'contacts', addressBookUrl: 'https://pim.example/frank/contacts/', authType: 'basic',
    authKey: 'k', enabled: true }]`, `defaultSource: 'id1'`, `migratedFrom: 'id1'`.
  - `migration keeps sync off when it was off`: same with `syncEnabled: false` → `enabled: false`.
  - `migration is idempotent`: input already has `sources` and `defaultSource` → returned unchanged, no `migratedFrom`,
    `newId` not called.
  - `no CardDAV url gives no sources`: `{ CardDAV: { addressBookUrl: '' } }` → `{ sources: [], defaultSource: '' }`.
  - `names a source after the url`: `'https://x/a/Family%20Book/'` → `'Family Book'`; `'https://x/'` → `'Contacts'`.
  - `validates names`: `''` and `'  '` → error; `'family'` with existing `Family` (other id) → error; same name with
    `selfId` of that source → `undefined`.
  - `finds a source by name`: `' FAMILY '` finds `Family`.

  In `tests/context.spec.ts`, update the settings fixture to the new shape and add `initSettings migrates CardDAV to a
  source` asserting the saved data has `sources` and no `CardDAV`. In `tests/friendly/mapping.spec.ts` add
  `source is reserved`.
- [ ] **Step 2: Run** `npm run test:run -- tests/sources.spec.ts tests/context.spec.ts tests/friendly/mapping.spec.ts` → FAIL.
- [ ] **Step 3: Implement** as in Interfaces. Other compile errors from removed fields are fixed in later tasks; to keep
  the build green in this task, change the remaining readers of `syncEnabled` / `CardDAV` minimally to read the default
  source (`sources.find((s) => s.id === defaultSource)`) — Task 2 replaces those reads properly.
- [ ] **Step 4: Run** `npm run test:run` and `npm run build` → PASS.
- [ ] **Step 5: Commit** `feat(sources): address book list in settings, migrated from the single CardDAV block`

### Task 2: Adapter bound to a source

**Files:**
- Modify: `src/sync/adapters/carddavGeneric.ts`, `src/sync/adapters/index.ts`, `src/sync/sync.ts`,
  `src/contacts/obsidianNotes.ts` (`remoteContacts`), `src/insights/processors/SyncUnknownProcessor.tsx`
  (enabled check only)
- Test: `tests/carddavAdapter.spec.ts`, `tests/e2e/radicale.e2e.ts` (settings setup only)

**Interfaces:**
- Produces:
  - `carddavAdapter(source: Pick<Source, 'addressBookUrl' | 'authType' | 'authKey'>): AdapterInterface` (rename of
    `carddavGenericAdapter`; every request uses the given source, never `getSettings()`).
  - In `src/sync/adapters/index.ts`: `activeSources(): Source[]` (enabled sources; `[]` on `Platform.isMobileApp`),
    `adapterFor(source: Source): AdapterInterface` (cached per source id + url + authKey), `isSyncAvailable(): boolean`
    (`activeSources().length > 0`). `getCurrentAdapter` is removed.
- Callers that need "a" source in this task use the default source if active (`defaultActiveSource(): Source |
  undefined`, exported from the same file); Tasks 4–6 make them source-aware.

- [ ] **Step 1: Update tests**: `tests/carddavAdapter.spec.ts` builds the adapter with `carddavAdapter({ addressBookUrl:
  baseUrl + 'frank/contacts/', authType: 'apikey', authKey: 'k' })` and no settings mock; add `two adapters use their
  own url and credentials` (requests of adapter A go to A's URL with A's header, B's to B's).
- [ ] **Step 2: Run** `npm run test:run -- tests/carddavAdapter.spec.ts` → FAIL.
- [ ] **Step 3: Implement.** Replace every `getCurrentAdapter()` / `settings.syncEnabled` read with the functions above.
- [ ] **Step 4: Run** `npm run test:run`, `npm run build`, `npm run test:e2e` → PASS.
- [ ] **Step 5: Commit** `refactor(sync): bind the CardDAV adapter to one address book`

### Task 3: Sync state per source

**Files:**
- Modify: `src/sync/syncState.ts` (`FileStore`), `src/contacts/obsidianNotes.ts` (`contactSyncState`,
  `obsidianFileStore` users), `src/main.ts` (`onload`)
- Test: `tests/syncState.spec.ts`

**Interfaces:**
- Produces:
  - `FileStore` gains `list(dir: string): Promise<string[]>` (file paths directly in `dir`, `[]` when missing) and
    `rename(from: string, to: string): Promise<void>`.
  - `contactSyncState(sourceId: string, app?: App): SyncState` — dir `<plugin dir>/sync-state/<sourceId>`, one shared
    instance per dir.
  - `migrateSyncStateDir(store: FileStore, root: string, sourceId: string): Promise<number>` in `syncState.ts` — moves
    every file directly in `root` (`index.json`, `*.vcf`) into `root/<sourceId>/`; returns the count; does nothing when
    `root/<sourceId>/index.json` already exists.
- `onload`: after `initSettings`, when the migration returned `migratedFrom`, run `migrateSyncStateDir` once
  (`initSettings` returns `{ migratedFrom?: string }`).

- [ ] **Step 1: Write the failing tests** (memory `FileStore` in the spec file gains `list`/`rename`):
  - `moves old sync state once`: files `s/index.json`, `s/a.vcf` → after migrate `s/id1/index.json`, `s/id1/a.vcf`,
    returns 2; a second run returns 0 and changes nothing.
  - `sources do not share bases`: `createSyncState(store, 's/A')` and `'s/B'` with the same UID keep separate entries.
- [ ] **Step 2: Run** `npm run test:run -- tests/syncState.spec.ts` → FAIL.
- [ ] **Step 3: Implement.** Every `contactSyncState(...)` caller passes the source id it works with (the default
  active source until Task 4).
- [ ] **Step 4: Run** `npm run test:run` and `npm run build` → PASS.
- [ ] **Step 5: Commit** `feat(sources): keep sync bases per address book`

### Task 4: Which source a note syncs with; moving between sources

**Files:**
- Modify: `src/sync/sources.ts`, `src/sync/sync.ts` (`runSync`, `deleteOnRemote`), `src/sync/syncContact.ts`
- Create: `src/sync/moveCard.ts`
- Test: `tests/sources.spec.ts`, `tests/moveCard.spec.ts` (new), `tests/syncContact.spec.ts`

**Interfaces:**
- Produces (`sources.ts`, pure):
  ```ts
  export type CardLocation = { sourceId: string; href: string; etag: string };
  export type SyncPlan =
    | { kind: 'sync'; sourceId: string }                    // card in the note's source, or no card anywhere -> sync/create there
    | { kind: 'adopt'; sourceId: string }                   // note has no source:, card found in exactly one source
    | { kind: 'move'; from: CardLocation; to: string }      // note names a source, card is in exactly one other
    | { kind: 'refuse'; message: string };
  export function noteSourceId(noteSource: string | undefined, sources: Source[], baseIn: string[], defaultSource: string): { id: string } | { error: string };
  export function planSync(noteSource: { id: string; explicit: boolean }, found: CardLocation[], sourceName: (id: string) => string): SyncPlan;
  ```
  - `noteSourceId`: explicit name → that source (error `Unknown address book 'X'` if missing, `Address book 'X' is not
    enabled` if disabled); no name → the first id in `baseIn` (sources holding a base for the UID), else the default;
    no default → error `No address book is set up`.
  - `planSync`: card in the note's source → `sync` (also when it is in others too); in no source → `sync` (creates);
    not in the note's source and in exactly one other → `adopt` when not explicit, `move` when explicit; in two or more
    others → `refuse` naming them (`Jan's card is in Private and Family; …`).
- Produces (`moveCard.ts`): `moveCard(raw: string, uid: string, from: { adapter: AdapterInterface; state: SyncState; location: CardLocation }, to: { adapter: AdapterInterface; state: SyncState }): Promise<{ ok: true; oldKept: boolean } | { ok: false; message: string }>`
  — PUT to `to` with `If-None-Match: *` (412 → `{ ok: false, 'The address book already has a card with this UID' }`,
  nothing else written); then DELETE `from` with `If-Match: location.etag`; then store the base in `to.state`
  (href from `getMetaByUid` like `createCard`) and remove it from `from.state`. A failed delete → `oldKept: true`.
- `syncContact` (`SyncDeps`) is unchanged except that the caller passes the chosen source's adapter and state.
- `runSync`: reads `source` from the frontmatter; computes `noteSourceId` (baseIn from each active source's state);
  looks the UID up in every active source (`getMetaByUid`, exact UID match as `findCard` does); `planSync`; then:
  `sync`/`adopt` → `syncNote` with that source; afterwards writes `source: <name>` into the note if it differs.
  `move` → `ConfirmModal` (see Rulings); on confirm `syncNote` against `from`, then `moveCard` with the base raw from
  `from`'s state, Notice `Moved <name> to <to>` or `… the old copy is still in <from>`. `refuse` → Notice.
  `deleteOnRemote` deletes in the note's source only.
- A note without `uid` keeps today's path (new UID, create) in its resolved source.

- [ ] **Step 1: Write the failing tests**:
  - `tests/sources.spec.ts`: `unknown or disabled source refuses`; `no source uses the source holding the base`;
    `no source and no base uses the default`; `card in own source syncs`; `card nowhere creates in own source`;
    `card only elsewhere is adopted without source`; `card only elsewhere is moved with explicit source`;
    `card in two other sources refuses and names them`.
  - `tests/moveCard.spec.ts` with fake adapters/states: `moves: create then delete then base` (call order asserted);
    `target already has the card refuses before deleting` (no DELETE call); `move with failed delete keeps both`
    (`oldKept: true`, base now in `to`, removed from `from`).
- [ ] **Step 2: Run** `npm run test:run -- tests/sources.spec.ts tests/moveCard.spec.ts` → FAIL.
- [ ] **Step 3: Implement** as in Interfaces.
- [ ] **Step 4: Run** `npm run test:run` and `npm run build` → PASS.
- [ ] **Step 5: Commit** `feat(sources): sync each note with its address book and move cards between books`

### Task 5: Remote contacts from every source

**Files:**
- Modify: `src/contacts/obsidianNotes.ts` (`RemoteContact`, `remoteContacts`, `ObsidianRelationContext`),
  `src/contacts/friendly/relations.ts` (`resolveRemoteName`), `src/sync/adapters/adapter.ts` (`VCardMeta`),
  `src/sync/adapters/carddavGeneric.ts` (`metaOf`), `src/util/vcard.ts`
- Test: `tests/friendly/relations.spec.ts`, `tests/context.spec.ts` or a new `tests/remoteContacts.spec.ts`

**Interfaces:**
- Produces:
  - `RemoteContact { uid: string; fileName: string; sourceId: string; href: string; etag: string; org?: string }`.
  - `VCardMeta` gains `org?: string` (first ORG component, unescaped), filled by `metaOf` via `orgOutOfString`.
  - `remoteContacts(): Promise<RemoteContact[]>` — all active sources, cache 5 minutes keyed by the set of active
    sources; a failing source is skipped with one Notice (`Could not read <name>: …`).
  - `resolveRemoteName(name, remote)` dedupes by UID first: the same UID with the same `fileName` counts once; a UID
    whose entries have different `fileName`s is ambiguous for any of those names.
  - `ObsidianRelationContext.uidToName`: a UID with different names across sources → `undefined`.

- [ ] **Step 1: Write the failing tests**: `same uid same name in two sources is not ambiguous`;
  `same uid different names is ambiguous`; `uidToName ignores a uid with two names`.
- [ ] **Step 2: Run** the touched spec files → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run test:run` and `npm run build` → PASS.
- [ ] **Step 5: Commit** `feat(sources): resolve relationships against every address book`

### Task 6: Import contact from server

**Files:**
- Create: `src/ui/modals/importContactModal.ts`
- Modify: `src/contacts/obsidianNotes.ts` (`importCard`, `importRemoteCard`), `src/sync/sync.ts`
  (`getUnknownFromRemote`, `pullFromRemote`), `src/insights/processors/SyncUnknownProcessor.tsx`, `src/main.ts`
  (command), `src/ui/sidebar/components/HeaderView.tsx` (button)
- Test: `tests/importList.spec.ts` (new)

**Interfaces:**
- Produces:
  - `importCandidates(remote: RemoteContact[], noteUids: string[]): RemoteContact[]` (pure, in `src/sync/sources.ts`):
    remote entries whose UID has no note; both entries of a UID present in two sources are kept; sorted by `fileName`.
  - `importRemoteCard(app, pulled: VCardRaw, meta: { href: string; etag?: string }, source: Source): Promise<boolean>`
    — the note gets `source: <source name>`; the base goes to `contactSyncState(source.id)`.
  - `importCard(app, card, extra?: Record<string, FriendlyValue>)`: `extra` (here `{ source }`) is written into the
    note's frontmatter after the mapped properties.
  - `ImportContactModal extends FuzzySuggestModal<RemoteContact>`: item text `<fileName>`, shown as
    `<fileName> · <source name>` plus ` · <org>` when present; choosing pulls from that source and imports. Opens with a
    Notice `No contacts to import` when the list is empty. One pick per open.
  - Command `friendly-contacts-import`, name `Import contact from server…`; a header button with the same action,
    shown when `isSyncAvailable()`.
  - The insight's queue item `data` carries `sourceId`; `ImportUnknownVcardToVault` pulls from that source.
- [ ] **Step 1: Write the failing tests**: `offers only cards without a note`; `offers a uid in two sources twice`;
  `sorts by name`.
- [ ] **Step 2: Run** `npm run test:run -- tests/importList.spec.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run test:run` and `npm run build` → PASS.
- [ ] **Step 5: Commit** `feat(import): import one contact from any address book`

### Task 7: Address books in the settings screen

**Files:**
- Create: `src/ui/settings/components/sourcesSettings.tsx`, `src/contacts/sourceNotes.ts`
- Modify: `src/ui/settings/components/synchronizationSettings.tsx` (replaced by the list, or reduced to the mobile
  callout + list), `src/ui/settings/components/carddavSettings.tsx` (reused per source)
- Test: `tests/sourceNotes.spec.ts` (new)

**Interfaces:**
- Produces (`sourceNotes.ts`, Obsidian-facing, logic testable with a fake app as in existing specs):
  - `notesUsingSource(app: App, source: Source, sources: Source[], defaultSource: string): Promise<TFile[]>` — notes
    whose `source` names it, plus notes without `source` whose UID has a base in that source.
  - `renameSourceInNotes(app: App, from: string, to: string): Promise<{ renamed: number; failed: string[] }>` — every
    contact note whose `source` equals `from` (case-insensitive) gets `to` via `processFrontMatter`.
- UI per source (one block each): name (validated with `validateSourceName`), URL, credentials exactly as today's
  `CarddavSettings` (locked while enabled, "Connected as …", masked secret, clear button), Enable/Disable (connectivity
  check on Enable, as today), "Default for new contacts" radio, Remove. "Add address book" button.
  - Remove: refused for the default (`Make another address book the default first.`) and when
    `notesUsingSource` is non-empty (`<n> contacts use <name>.`); otherwise ConfirmModal, then removed together with its
    `sync-state/<id>/` directory.
  - Rename: ConfirmModal `Rename <from> to <to> in <n> contact notes?`; notes first, then the setting; failures listed
    in the console and counted in the Notice.
  - The mobile callout stays.
- [ ] **Step 1: Write the failing tests**: `finds notes by explicit source and by base`; `rename rewrites only that
  source`; `rename reports failed notes`.
- [ ] **Step 2: Run** `npm run test:run -- tests/sourceNotes.spec.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run test:run` and `npm run build` → PASS.
- [ ] **Step 5: Commit** `feat(settings): manage several address books`

### Task 8: Property rename refuses instead of skipping

**Files:**
- Modify: `src/contacts/obsidianNotes.ts` (`notesToRename`, `renamePropertyInNotes`),
  `src/ui/settings/components/propertyNamesSettings.tsx`
- Test: `tests/convertNotes.spec.ts` or the spec that covers `renameAllInFrontmatter` (add there)

**Interfaces:**
- Produces: `renameBlockers(app: App, renames: Rename[]): TFile[]` — contact notes where a target name already has a
  value. `renamePropertyInNotes` is only called when it is empty; it no longer skips.
- UI: when blockers exist, the mapping change is reverted and a Notice says `Not renamed: <n> notes already have
  <to>. See console.`; the paths are logged.
- [ ] **Step 1: Write the failing test** `rename with an existing target is refused for all notes` (no note changed).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** full suite + build → PASS.
- [ ] **Step 5: Commit** `fix(settings): refuse a property rename that would overwrite values`

### Task 9: End-to-end with two address books

**Files:**
- Modify: `tests/e2e/radicale.e2e.ts`, `tests/scripts/radicale-e2e.md`

- [ ] **Step 1: Add e2e cases** (second address book `/frank/family/` on the same Radicale):
  - `imports from both books` (each card's base lands in its own source dir);
  - `moves a card between books` (card in the new book, gone from the old, untouched lines byte-identical);
  - `refuses when the target book has the card`.
  Extend the manual checklist with: add a second book, import from it, change `source:` and Sync, rename a book.
- [ ] **Step 2: Run** `npm run test:e2e` → PASS (`npm run test:run`, `npm run build` too).
- [ ] **Step 3: Commit** `test(e2e): two address books`
