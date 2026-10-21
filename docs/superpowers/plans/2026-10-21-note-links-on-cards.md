# Links to Obsidian notes on cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** With the setting "Links to Obsidian notes on cards" on (off by default), every relationship to a contact
note gets a website entry `itemN.URL:obsidian://open?vault=…&file=…` + `itemN.X-ABLabel:<name>` on the card, so the
person is tappable in Android Contacts; the links follow relationships, renames, the vault name and the setting by
themselves, and never reach the note.

**Architecture:** A pure module `noteLinks.ts` builds link URLs, recognises the plugin's own link lines (a grouped
`URL` whose `obsidian://open?` value names a vault the plugin has written links for) and computes the wanted links
from a note's relationships. `toFriendly` skips own link lines everywhere (so they are never a `website`, never in a
review row, a base comparison or an import), and `patch`/`newCard` reconcile them against the wanted list when asked.
`prepareSync` opens the review with the info line when the card's own links differ from the wanted ones (like the
legacy relationship rewrite); `applySync` always reconciles from the result. The vault name is stored in the
travelling settings when the setting is first turned on, so every desktop writes and recognises the same links.

**Tech Stack:** TypeScript, Obsidian API, React (settings), vitest (unit, jsdom for UI), vitest + Radicale 3.8.3 (e2e).

**Spec:** `docs/superpowers/specs/2026-10-20-note-links-on-cards-design.md`

## Global Constraints

- Setting name: **Links to Obsidian notes on cards**; off by default. Field: **Vault name on your phone**.
- URL: `obsidian://open?vault=<encodeURIComponent(vault)>&file=<encodeURIComponent(note path without .md)>`.
- Card form on **both** vCard 3.0 and 4.0: `itemN.URL:<url>` + `itemN.X-ABLabel:<label>`, `N` the next free item
  number; the label is the other person's display name (`contactDisplayName`), escaped as text, **never** wrapped as an
  Apple label (`_$!<…>!$_`, so not through `writeLabel`).
- One link per distinct contact note, in mapping order of the relationship rows, then the order in the note.
  Relationships that resolve to no contact note get no link; no link to the contact's own note.
- An own link line: has a group, name `URL`, a value that parses as `obsidian://open?` with both `vault` and `file`,
  and a `vault` in `ownVaults` (the stored vault name plus former stored names). An ungrouped `URL` line is never
  own, and neither is a link to another vault. An install that never turned the setting on has no own vaults.
- Own link lines are never read: no `website`, no review row, not in base comparison, not on import, never in a note.
- Card links are compared to the wanted links as a set of `(url, label)`; order on the card never causes a rewrite.
- Info line, exact text: `Links to Obsidian notes on this card are updated.`
- Turning the setting on or off, or changing the vault name, never removes a website the owner or the phone wrote
  and never puts a link into a note; turning it off removes only own links, at each contact's next Sync.
- A card's `VERSION` never changes; untouched lines stay byte-identical.
- Git: never add `Co-Authored-By` or mention an LLM/agent in commit messages. UI text and code in English.

## Review Focus

1. **The vault name differs per desktop, or is changed later.** Sync runs on desktops and `app.vault.getName()` may
   differ between them; with "this vault's name" as the recognising rule, the other desktop would read the links as
   `website` into the note and rewrite them back and forth. Links are written with the stored name, recognised by the
   stored and former stored names; a link with a former name is replaced at the next Sync, never read as `website`
   — Task 1 tests (`setLinkVault`, `noteLinkOptions`) and Task 3 test.
2. **The owner's own `obsidian://` website.** A `website: obsidian://open?vault=<this vault>&file=Projects/Foo` in
   the note is written as a plain `URL:` line; it stays a website, is never removed by the reconcile, and the second
   Sync is up to date (no duplicate line each Sync) — Task 2 and Task 3 tests.
3. **A base from another device, or from before the links (the anti-goal of labelled dates).** Links are left out of
   every read, so a base stored without links, with old links, or by another desktop gives the same props as one with
   the current links: no removal, no `website`, no `storedAt` rule needed. A base without links and a server card
   with the wanted links is up to date — Task 3 test.
4. **The phone rewrites the card.** DAVx5 reorders lines, the owner edits a link's label or deletes a link on the
   phone: reordering is no difference; a changed label is put back in place; a deleted link is added again; the
   Sync after that is up to date — Task 2 tests (`noteLinksDiffer`, reconcile).
5. **Label text.** A display name with a comma or semicolon (`Verhallen, Ger`), an Apple built-in word (`Manager`) or
   non-ASCII, and a long URL that folds: escaped label (`Verhallen\, Ger`), no `_$!<…>!$_`, parsed back equal after
   folding — Task 2 tests.

---

### Task 1: Note-link model (pure)

**Files:**
- Create: `src/contacts/friendly/noteLinks.ts`
- Modify: `src/contacts/friendly/relations.ts` (`RelationContext`)
- Test: `tests/friendly/noteLinks.spec.ts`

**Interfaces:**
- Produces in `relations.ts`: `RelationContext` gains the optional lookup
  `contactNote?(target: string): { path: string; name: string } | undefined` — the contact note a link target
  resolves to (vault path with `.md`, display name); never writes. Absent: no contact note is known (no links).
- Produces in `noteLinks.ts` (no obsidian imports):
  - `type NoteLinksSettings = { enabled: boolean; vaultName: string; formerVaultNames: string[] }` (stored in
    data.json) and `DEFAULT_NOTE_LINKS: NoteLinksSettings = { enabled: false, vaultName: '', formerVaultNames: [] }`.
  - `normalizeNoteLinks(stored: unknown): NoteLinksSettings` — missing or wrong-typed fields get the default; names
    trimmed; empty and duplicate former names dropped.
  - `turnNoteLinks(stored: NoteLinksSettings, on: boolean, deviceVault: string): NoteLinksSettings` — sets `enabled`;
    turning on with an empty `vaultName` fills it with `deviceVault`.
  - `setLinkVault(stored: NoteLinksSettings, name: string, deviceVault: string): NoteLinksSettings` — new name =
    `name.trim()` or, when empty, `deviceVault`; the old non-empty name moves to `formerVaultNames` (unique), the new
    name is removed from it.
  - `type NoteLinkOptions = { enabled: boolean; vault: string; ownVaults: string[] }` (what Sync uses) and
    `noteLinkOptions(stored: NoteLinksSettings): NoteLinkOptions` — `enabled: stored.enabled && vaultName !== ''`,
    `vault: vaultName`, `ownVaults: vaultName === '' ? [] : unique([vaultName, ...formerVaultNames])`.
  - `noteLinkUrl(vault: string, notePath: string): string` — see Global Constraints; a trailing `.md` (any case) is
    dropped.
  - `parseNoteLink(value: string): { vault: string; file: string } | undefined` — `value` as on the card (unescaped
    first); scheme and `open` case-insensitive; query split on `&`, each part `decodeURIComponent` (a bad escape:
    undefined); both `vault` and `file` needed, in any order.
  - `isOwnNoteLink(line: VCardLine, ownVaults: readonly string[]): boolean` — see Global Constraints; vault compared
    ignoring case.
  - `cardNoteLinks(lines: VCardLine[], ownVaults: readonly string[]): { line: number; url: string; label?: string; labelLine?: number }[]`
    — own link lines in card order, with their group's first `X-ABLabel` (unescaped) and its index.
  - `type NoteLink = { url: string; label: string }`.
  - `wantedNoteLinks(props: Record<string, FriendlyValue>, rows: MappingRow[], ctx: RelationContext, vault: string): NoteLink[]`
    — relation properties (`spouse`, `spouse-2`, `children`, …) sorted by row index then ordinal, items in order;
    each item `ctx.contactNote?.(linkTarget(item.trim()))`; first occurrence per path wins; label = `name`.
  - `noteLinksDiffer(lines: VCardLine[], wanted: NoteLink[], ownVaults: readonly string[]): boolean` — the card's own
    `(url, label)` pairs (a missing label counts as `''`) and the wanted pairs differ as multisets (a duplicate own
    link on the card is a difference; order is not).

- [ ] **Step 1: Write the failing tests** in `tests/friendly/noteLinks.spec.ts` (`ger = { path: 'Contacts/Ger Verhallen.md', name: 'Ger Verhallen' }`, a fake ctx whose `contactNote` maps `Ger Verhallen` and `Contacts/Ger Verhallen` to `ger`, `Sem` to `Contacts/Sem/index.md`/`Sem de Vries`, `Piet` to undefined):
  - `noteLinkUrl('My Notes', 'Contacts/Ger Verhallen.md')` is `obsidian://open?vault=My%20Notes&file=Contacts%2FGer%20Verhallen`.
  - `parseNoteLink` of that URL is `{ vault: 'My Notes', file: 'Contacts/Ger Verhallen' }`; of `OBSIDIAN://open?file=a&vault=b` is `{ vault: 'b', file: 'a' }`; of `obsidian://open?vault=b`, `obsidian://open?path=%2Fx`, `https://example.org` and `obsidian://open?vault=%E0&file=a` is undefined.
  - `isOwnNoteLink` with `ownVaults = ['Notes']`: `item1.URL:obsidian://open?vault=Notes&file=a` true, `…vault=notes…` true; ungrouped `URL:obsidian://open?vault=Notes&file=a` false (Review Focus 2); `item1.URL:obsidian://open?vault=Other&file=a` false; with `ownVaults = []` everything false (Review Focus 1).
  - `cardNoteLinks` on `item2.URL:<url>`, `item2.X-ABLabel:Ger Verhallen\, sr`, `item3.URL:<url2>` (no label) gives `[{ line: 0, url, label: 'Ger Verhallen, sr', labelLine: 1 }, { line: 2, url: url2 }]`.
  - `wantedNoteLinks({ friends: ['[[Piet]]', '[[Ger Verhallen]]'], spouse: '[[Contacts/Ger Verhallen|Ger]]', children: ['[[Sem]]'] }, DEFAULT_MAPPING, ctx, 'Notes')` is `[Ger (from spouse), Sem]` with labels `Ger Verhallen`, `Sem de Vries`; with a ctx without `contactNote` it is `[]`.
  - `noteLinksDiffer`: same pairs in another order false; one label changed true; a duplicate own link true; an extra own link true; a non-own `URL` and an `obsidian://` link to another vault are ignored.
  - `normalizeNoteLinks(undefined)` equals `DEFAULT_NOTE_LINKS`; `normalizeNoteLinks({ enabled: 'yes', vaultName: ' N ', formerVaultNames: ['A', '', 'A', 3] })` is `{ enabled: false, vaultName: 'N', formerVaultNames: ['A'] }`.
  - `turnNoteLinks(DEFAULT_NOTE_LINKS, true, 'Mac Notes')` is `{ enabled: true, vaultName: 'Mac Notes', formerVaultNames: [] }`; turning off keeps `vaultName`; turning on again keeps a stored `Phone`.
  - `setLinkVault({ enabled: true, vaultName: 'Mac Notes', formerVaultNames: [] }, 'Phone', 'Mac Notes')` gives `vaultName: 'Phone', formerVaultNames: ['Mac Notes']`; then `setLinkVault(…, '  ', 'Mac Notes')` gives `vaultName: 'Mac Notes', formerVaultNames: ['Phone']`.
  - `noteLinkOptions` of that last value is `{ enabled: true, vault: 'Mac Notes', ownVaults: ['Mac Notes', 'Phone'] }`; of `DEFAULT_NOTE_LINKS` is `{ enabled: false, vault: '', ownVaults: [] }`; of `{ enabled: true, vaultName: '', … }` has `enabled: false`.

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/friendly/noteLinks.spec.ts`
Expected: FAIL (module `noteLinks` not found).

- [ ] **Step 3: Implement** `noteLinks.ts` and the `RelationContext` member with the signatures above.

- [ ] **Step 4: Run the whole unit suite**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/contacts/friendly/noteLinks.ts src/contacts/friendly/relations.ts tests/friendly/noteLinks.spec.ts
git commit -m "feat(links): model for links to Obsidian notes on cards"
```

### Task 2: Skip own links when reading, reconcile them when writing

**Files:**
- Modify: `src/contacts/friendly/translate.ts` (`toFriendly` options)
- Modify: `src/contacts/friendly/patch.ts` (`PatchOptions`, `patch`, `newCard`)
- Test: `tests/friendly/toFriendly.spec.ts`, `tests/friendly/patch.spec.ts`

**Interfaces:**
- Consumes: `isOwnNoteLink`, `cardNoteLinks`, `NoteLink`, `noteLinkUrl` (Task 1).
- Produces:
  - `toFriendly(lines, rows, ctx, opts: { reader?: Reader; ownVaults?: readonly string[] } = {})` — own link lines
    feed no row (provenance indexes stay those of the full line list).
  - `PatchOptions.noteLinks?: { wanted: NoteLink[]; ownVaults: string[] }` — when given, after the legacy rewrite
    and before `REV`, the card's own links are made equal to `wanted`; when absent, own links are left alone.
  - `newCard(props, rows, ctx, version = '4.0', opts: Pick<PatchOptions, 'noteLinks'> = {})` passes `noteLinks` on.

Reconcile (decisions; the implementer writes the code): walk `cardNoteLinks(base)` (skipping removed lines) in card
order. A URL that is wanted and not yet kept is kept: its line untouched; when its label differs, the label line gets
the escaped new label in place (no label line: one is placed right after the URL line through `s.after`). Any other own
link is removed with `removeLine` (its label goes with it). Then every wanted link not kept is appended in wanted order
as `{ group, name: 'URL', params: [], value: url }` + `{ group, name: 'X-ABLabel', params: [], value: escapeText(label) }`
with `group = newGroup(s)` (not `labelled`, which applies `writeLabel`).

- [ ] **Step 1: Write the failing tests** (`own = ['Notes']`, `url = noteLinkUrl('Notes', 'Contacts/Ger Verhallen.md')`, `ger = { url, label: 'Ger Verhallen' }`):
  - toFriendly, 3.0 and 4.0: `URL:https://a.example`, `item4.URL:<url>`, `item4.X-ABLabel:Ger Verhallen`, `URL:https://b.example` with `{ ownVaults: own }` reads `website: 'https://a.example'`, `website-2: 'https://b.example'` and nothing else from those lines; `source['website-2']` points at the `https://b.example` line (index in the full list). Without `ownVaults` (as today) the link is `website-2`. A plain `URL:obsidian://open?vault=Notes&file=Projects%2FFoo` is read as `website` with `ownVaults` (Review Focus 2).
  - patch, 3.0 card with `item3.X-ABRELATEDNAMES:Ger Verhallen` + label and `noteLinks: { wanted: [ger], ownVaults: own }`: the added lines serialize as exactly `item4.URL:obsidian://open?vault=Notes&file=Contacts%2FGer%20Verhallen` and `item4.X-ABLabel:Ger Verhallen`; every other line keeps its `raw`; `VERSION` unchanged. Same on a 4.0 card.
  - patch, card already holding `ger` (other props equal): no line changes and `REV` stays (no rewrite when equal).
  - patch, card holding `ger` with label `Ger` (phone edit): only the label line changes, to `item4.X-ABLabel:Ger Verhallen` (Review Focus 4).
  - patch, `wanted: []`: the own group (URL + label) is removed; a plain `URL:obsidian://open?vault=Notes&file=x`, an `item5.URL:https://blog.example` with label `Blog` and an `item6.URL:obsidian://open?vault=Other&file=x` stay byte-identical.
  - patch, two own groups with the same URL and `wanted: [ger]`: the first is kept, the second removed.
  - patch, wanted URL changed (note moved to `Contacts/Ger Verhallen/index.md`): the old group removed, a new group with the next free number appended; a card with `item9.X-ABDATE` + label gets `item10`; two new links get `item10` and `item11` (group numbers never collide).
  - patch, label `Verhallen, Ger` writes `item4.X-ABLabel:Verhallen\, Ger`; label `Manager` writes `item4.X-ABLabel:Manager` (Review Focus 5); a long path (`Contacts/Ger Verhallen van der Berg-Hoogeveen/index.md`) serializes folded and `cardNoteLinks(parseCard(serializeCard(lines)), own)` gives the same URL back.
  - newCard with `noteLinks: { wanted: [ger], ownVaults: own }`, version `3.0` and `4.0`: the card holds the two lines; without the option it holds none.
  - patch without `noteLinks`: own groups untouched.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/friendly/toFriendly.spec.ts tests/friendly/patch.spec.ts`
Expected: FAIL on the new cases (`ownVaults` ignored, no link lines written).

- [ ] **Step 3: Implement** the `toFriendly` option, `PatchOptions.noteLinks`, the reconcile and the `newCard` option.

- [ ] **Step 4: Run the whole unit suite**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/contacts/friendly/translate.ts src/contacts/friendly/patch.ts tests/friendly/toFriendly.spec.ts tests/friendly/patch.spec.ts
git commit -m "feat(links): skip own links when reading cards, reconcile them when writing"
```

### Task 3: Sync decides and writes the links

**Files:**
- Modify: `src/sync/syncContact.ts` (`SyncDeps`, `PreparedSync`, `prepareSync`, `serverCard`, `applySync`)
- Modify: `src/sync/syncFlow.ts` (`LINKS_LINE`, `ReviewRequest.linksLine`, `SyncFlowDeps.noteLinks`)
- Modify: `src/ui/modals/syncReviewModal.tsx` (show `linksLine`; rewrite-only also for it)
- Test: `tests/syncContact.spec.ts`, `tests/syncFlow.spec.ts`

**Interfaces:**
- Consumes: Task 1 (`NoteLinkOptions`, `wantedNoteLinks`, `noteLinksDiffer`), Task 2 (`toFriendly` `ownVaults`,
  `PatchOptions.noteLinks`, `newCard` opts).
- Produces:
  - `SyncDeps.noteLinks?: NoteLinkOptions` — absent: no own vaults and no links (today's behaviour).
  - `PreparedSync.rewriteLinks: boolean` — the server card's own links differ from the links wanted for the note.
  - `export const LINKS_LINE = 'Links to Obsidian notes on this card are updated.'` in `syncFlow.ts`;
    `ReviewRequest.linksLine?: string` (set when `rewriteLinks`); `SyncFlowDeps.noteLinks?: NoteLinkOptions`, passed
    into `SyncDeps`.

Behaviour (decisions):
- Every `toFriendly` in `syncContact.ts` (base, server card, and both `final` reads in Apply) passes
  `ownVaults: deps.noteLinks?.ownVaults ?? []`; one small local helper keeps them alike.
- `wanted(props) = deps.noteLinks?.enabled ? wantedNoteLinks(props, deps.rows, deps.readOnlyCtx, deps.noteLinks.vault) : []`
  — always `readOnlyCtx`, in prepare and Apply, so both decide alike (see the `readOnlyCtx` comment in `SyncDeps`).
- Prepare: `rewriteLinks = server !== undefined && deps.noteLinks !== undefined && noteLinksDiffer(server.lines, wanted(L), deps.noteLinks.ownVaults)`;
  up to date only when `isUpToDate(rows, rewriteRelations || rewriteLinks)`.
- Apply: with `deps.noteLinks`, `patch(…, { rewriteLegacyRelations, noteLinks: { wanted: wanted(result), ownVaults } })`
  — from the result, so a relationship pulled from the card gets its link in the same Apply; a new card gets
  `newCard(…, version, { noteLinks: … })`.
- syncFlow: `linksLine: review.rewriteLinks ? LINKS_LINE : undefined`. Modal: `<p className="friendly-review-rewrite">`
  for it too; `isRewriteOnly(rows, input.rewriteLine !== undefined || input.linksLine !== undefined)`.

- [ ] **Step 1: Write the failing tests** with `noteLinks = { enabled: true, vault: 'Notes', ownVaults: ['Notes'] }` and a ctx whose `contactNote` resolves `Sem` to `{ path: 'Contacts/Sem.md', name: 'Sem de Vries' }`; local `{ …, spouse: '[[Sem]]' }`, card and base holding the spouse line:
  - syncContact: card without links → prepare is `review`, `rewriteLinks: true`, no row `changed`; Apply pushes a card whose only new lines are the two link lines; the note gets no `website` and no write besides `source`; the next prepare is `upToDate`.
  - syncContact: the card holds the link, the base (stored earlier, by another device) does not → `upToDate`; base holds a link with a former vault name `Mac Notes` (`ownVaults: ['Notes', 'Mac Notes']`) and the card the current one → `upToDate`; card holds the `Mac Notes` link → review with `rewriteLinks`, Apply replaces it and the note gets no `website` (Review Focus 1, 3).
  - syncContact: `contactNote` now gives `Contacts/Sem/index.md` (renamed into a folder) → one review, Apply changes the URL, then `upToDate`.
  - syncContact: `enabled: false`, card holds the link → review with `rewriteLinks`; Apply removes it; then `upToDate`. `noteLinks` absent (or `ownVaults: []`), the same card → the link reads as `website` exactly as today and nothing is removed (Review Focus 1).
  - syncContact: note with `website: 'obsidian://open?vault=Notes&file=Projects%2FFoo'` pushed to a card without it → card gets a plain `URL:` line; the next prepare is `upToDate` and the card holds that line once (Review Focus 2).
  - syncContact: the card adds `partner: [[Anna]]` (a phone edit; `contactNote('Anna')` is `Contacts/Anna.md`) → Apply pulls `partner` into the note and the pushed card holds links for Sem and Anna, in that order.
  - syncContact: `spouse` removed from the note → Apply removes the relationship line and Sem's link; then `upToDate`.
  - syncContact: a new card (no server) with `spouse: '[[Sem]]'` is created with the link lines.
  - syncFlow: `LINKS_LINE` has the exact text; a rewrite-only review request has `linksLine === LINKS_LINE`, `rewriteLine` undefined, and no changed row; without the difference `linksLine` is undefined.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/syncContact.spec.ts tests/syncFlow.spec.ts`
Expected: FAIL (`noteLinks` not used; `LINKS_LINE` not exported).

- [ ] **Step 3: Implement** the `syncContact.ts`, `syncFlow.ts` and modal changes.

- [ ] **Step 4: Run the whole unit suite and the build**

Run: `npx vitest run && npm run build`
Expected: all pass (`tests/pureModules.spec.ts` included: `noteLinks.ts` stays obsidian-free); no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/sync/syncContact.ts src/sync/syncFlow.ts src/ui/modals/syncReviewModal.tsx tests/syncContact.spec.ts tests/syncFlow.spec.ts
git commit -m "feat(links): Sync writes links to Obsidian notes and keeps them right"
```

### Task 4: Obsidian wiring: settings storage, contact-note lookup, import and export

**Files:**
- Modify: `src/settings/settings.d.ts` (`noteLinks: NoteLinksSettings` on `ContactsPluginSettings`)
- Modify: `src/settings/setting.ts` (`DEFAULT_SETTINGS.noteLinks = DEFAULT_NOTE_LINKS`)
- Modify: `src/context/sharedSettingsContext.ts` (`noteLinks: normalizeNoteLinks(loaded.noteLinks)` in `initSettings`)
- Modify: `src/contacts/obsidianNotes.ts` (`ObsidianRelationContext.contactNote`, `importCard`, `friendlyNoteCard`)
- Modify: `src/sync/sync.ts` (`runSync` passes `noteLinks: noteLinkOptions(settings.noteLinks)`)
- Test: `tests/relationLinks.spec.ts`, `tests/context.spec.ts`, `tests/importRemoteCard.spec.ts`

**Interfaces:**
- Consumes: Task 1 (`normalizeNoteLinks`, `noteLinkOptions`, `DEFAULT_NOTE_LINKS`), Task 2 (`ownVaults`), Task 3
  (`SyncFlowDeps.noteLinks`).
- Produces: `ObsidianRelationContext.contactNote(target)` — the same note `resolveLink` finds (Obsidian's link
  resolution, else the one contact note with that display name; several: undefined), but only contact notes, no UID
  needed and nothing written in either mode; `{ path: file.path, name: contactDisplayName(app, file) }`. The shared
  lookup becomes one private method used by both.

Behaviour (decisions):
- `importCard`: `toFriendly(lines, friendly.mapping, ctx, { ownVaults: noteLinkOptions(getSettings().noteLinks).ownVaults })`.
- `friendlyNoteCard` (export): the base is read with the same `ownVaults`; no `noteLinks` passed to `patch`, so the
  exported card keeps the links as the last Sync left them.

- [ ] **Step 1: Write the failing tests:**
  - relationLinks (the `vault()` of "a link Obsidian cannot resolve finds the contact note by its name"): for readOnly `true` and `false`, `contactNote('Jan')` is `{ path: 'Contacts/Jan/index.md', name: 'Jan' }` (found by name); a link to a note that is no contact note gives undefined; two contacts with that display name give undefined; a contact note without UID still gives its path and nothing is written (`settle()` writes nothing).
  - context: `initSettings` with no `noteLinks` stored gives `DEFAULT_NOTE_LINKS`; a stored `{ enabled: true, vaultName: 'Notes', formerVaultNames: ['Old'] }` is kept.
  - importRemoteCard: with settings `noteLinks: { enabled: true, vaultName: 'Notes', formerVaultNames: [] }`, a card holding `URL:https://a.example` and an own link group imports `website: https://a.example` and no `website-2`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/relationLinks.spec.ts tests/context.spec.ts tests/importRemoteCard.spec.ts`
Expected: FAIL (`contactNote` missing, `noteLinks` not in settings, link imported as `website-2`).

- [ ] **Step 3: Implement** the settings field, the lookup, the `importCard`/`friendlyNoteCard` options and the `runSync` wiring.

- [ ] **Step 4: Run the unit suite and the build**

Run: `npx vitest run && npm run build`
Expected: all pass; no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/settings/settings.d.ts src/settings/setting.ts src/context/sharedSettingsContext.ts src/contacts/obsidianNotes.ts src/sync/sync.ts tests/relationLinks.spec.ts tests/context.spec.ts tests/importRemoteCard.spec.ts
git commit -m "feat(links): wire links to Obsidian notes into Sync, import and export"
```

### Task 5: The setting in the settings screen, and the README

**Files:**
- Create: `src/ui/settings/components/noteLinksSettings.tsx`
- Modify: `src/ui/settings/components/synchronizationSettings.tsx` (render it after `<SourcesSettings>`)
- Modify: `README.md` (new subsection `### 🔗 Links to Obsidian notes on cards` right after `### 📱 Relationships on phones` and its `#### New contacts` part, before `### 📅 Dates with a label`)
- Test: `tests/ui/noteLinksSettings.spec.ts` (jsdom, like `tests/ui/dateLabelsSettings.spec.ts`, with `initSettings` on a fake store)

**Interfaces:**
- Consumes: `turnNoteLinks`, `setLinkVault` (Task 1); `getSettings`, `setSettings`; `CommitInput`.
- Produces: `NoteLinksSettings({ app }: { app: App })`.

Behaviour (decisions):
- A `setting-item` with name **Links to Obsidian notes on cards**, description: `Adds a website to each card for every
  relationship with a contact note: an obsidian:// link to that note, labelled with the person's name. On Android
  (DAVx5) you tap it to open the note. Cards get or lose the links at each contact's next Sync.` and a switch like
  "Mirror relationships on this device" (`role="switch"`, `aria-label` the setting name). Toggling saves
  `turnNoteLinks(current.noteLinks, on, app.vault.getName())`.
- While on: a `setting-item` **Vault name on your phone**, description: `The name of this vault in Obsidian on your
  phone. Links open the note in the vault with this name.`, a `CommitInput` (`label` the field name) holding
  `vaultName`; a commit saves `setLinkVault(current.noteLinks, text, app.vault.getName())`.
- README: what the setting does and that it is off by default; the card form; that it is for phones (Android:
  website entries; whether the contacts app opens `obsidian://` links depends on the app, so test one contact on the
  phone first); the vault-name field (filled with this vault's name when turned on; change it when the phone's vault
  has another name); that links follow relationships, renames, the vault name and turning it off at each contact's
  next Sync (review screen with the line "Links to Obsidian notes on this card are updated."); that they never appear
  in notes and websites you added yourself are never touched; update the plugin on every desktop that syncs before
  turning it on (an older version reads the links as websites).

- [ ] **Step 1: Write the failing tests** in `tests/ui/noteLinksSettings.spec.ts` (`app.vault.getName()` returns `Mac Notes`):
  - Off by default: the switch has `aria-checked="false"` and the vault field is absent.
  - Click the switch: `getSettings().noteLinks` is `{ enabled: true, vaultName: 'Mac Notes', formerVaultNames: [] }` and the field shows `Mac Notes`.
  - Type `Phone Notes` and blur: `vaultName: 'Phone Notes'`, `formerVaultNames: ['Mac Notes']`; clear the field and blur: `vaultName: 'Mac Notes'`.
  - Click the switch again: `enabled: false`, `vaultName` kept, the field hidden.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/ui/noteLinksSettings.spec.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** the component, render it, write the README subsection.

- [ ] **Step 4: Run the unit suite and the build**

Run: `npx vitest run && npm run build`
Expected: all pass; no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/ui/settings/components/noteLinksSettings.tsx src/ui/settings/components/synchronizationSettings.tsx tests/ui/noteLinksSettings.spec.ts README.md
git commit -m "feat(links): setting for links to Obsidian notes on cards"
```

### Task 6: End-to-end against Radicale

**Files:**
- Modify: `tests/e2e/radicale.e2e.ts`

**Interfaces:**
- Consumes: `NoteLinkOptions`, `noteLinkUrl` (Task 1), `SyncFlowDeps.noteLinks`, `ReviewRequest.linksLine`,
  `LINKS_LINE` (Task 3).
- The harness gets `let noteLinks: NoteLinkOptions | undefined;` passed to `syncFlow`, records `linksLine` next to
  `rewriteLine`, and the fake `relationContext` gets `contactNote(target)`: the note named `target` (or whose path
  is `target`) at `paths.get(name) ?? \`Contacts/${name}.md\`` with `paths: Map<string, string>` settable by a test.
  The new test resets `noteLinks` and `paths` in a `finally`.

- [ ] **Step 1: Write test 21** `21. %s: links to Obsidian notes: written, followed after a rename, removed when off`, for 3.0 and 4.0:
  - PUT Ger and Jose; Jose's card holds his spouse line to Ger in that version's form and `URL:https://jose.example`; import Jose; Sync is `unchanged`.
  - `noteLinks = { enabled: true, vault: 'Notes', ownVaults: ['Notes'] }`: Sync is `pushed` with `linksLine === LINKS_LINE`; the only new lines on the card on Radicale are `itemN.URL:obsidian://open?vault=Notes&file=Contacts%2FGer%20Verhallen` + `itemN.X-ABLabel:Ger Verhallen`, every other line unchanged (`REV` aside); the note has no new property; the next Sync is `unchanged`.
  - `paths.set('Ger Verhallen', 'Contacts/Ger Verhallen/index.md')`: Sync is `pushed`; only the URL changed (`…file=Contacts%2FGer%20Verhallen%2Findex`); the next Sync is `unchanged`.
  - `noteLinks = { enabled: false, vault: 'Notes', ownVaults: ['Notes'] }`: Sync is `pushed`; both link lines are gone, `URL:https://jose.example` is still there byte-identical; the next Sync is `unchanged`.

- [ ] **Step 2: Run the e2e suite**

Run: `npm run test:e2e`
Expected: all pass (21 included); the existing tests unchanged.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/radicale.e2e.ts
git commit -m "test(e2e): links to Obsidian notes round-trip through Radicale"
```
