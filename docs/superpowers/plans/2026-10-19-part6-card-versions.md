# Part 6: Card Versions and Relationships Phones Understand — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Relationships and anniversaries are written in the form each card's vCard version uses (Apple/DAVx5 style
for 3.0, `RELATED` text for 4.0) and every form is read; a `partner` relationship; new cards follow the address
book's version; the address book is chosen when creating a contact.

**Architecture:** The pure translator (`src/contacts/friendly/translate.ts`, `patch.ts`, `mapping.ts`) learns group
labels (`X-ABLabel`) and per-version writing. Relation rows get Apple/DAVx5 labels. A stored-mapping migration adds
the new row and labels. Sources get a "new contacts" version setting and version statistics. The create-contact
modal gets an address book dropdown.

**Tech Stack:** TypeScript, Obsidian API, React 18, vitest, Radicale e2e.

**Spec:** `docs/superpowers/specs/2026-10-18-sources-review-folders-design.md`, Part 6.

## Global Constraints

- Commits: never add `Co-Authored-By` or mention any LLM/agent.
- `src/contacts/friendly/*`, `src/sync/review.ts`, `syncContact.ts`, `syncFlow.ts` stay obsidian-free (guard test).
- Unchanged vCard lines stay byte-identical; a card's `VERSION` is never changed.
- Label texts and the label table exactly as in the spec (Part 6, "Reading").
- Hint parameter name exactly `X-FRIENDLY-UID`; the 4.0 form exactly `RELATED;TYPE=<type>;VALUE=text;X-FRIENDLY-UID=<uid>:<name>`.
- `npm run test:run`, `npm run build`, `npm run test:e2e` pass at the end of every task. Lock stays npm-10
  installable (no new dependencies).

## Rulings made while planning

- Ruling: `partner` is `single` like `spouse` (one current partner); the graph kind is partner — cost if wrong: a
  hand-edited list still works (lists are read), only "+ Relationship" replaces instead of adds.
- Ruling: the display name written on cards comes from a new `RelationContext.displayName(uid)` (name property, else
  the contact's name; never a path/alias) — `uidToName` returns link text, which can be a path in folder layout —
  cost: one interface method.
- Ruling: "Automatic" with an empty book or a tie uses vCard 3.0 — most widely understood — cost if wrong: a new card
  in an empty 4.0-only setup starts as 3.0 (still read everywhere).

## Review Focus

1. **A DAVx5 3.0 card with `item3.X-ABRELATEDNAMES:Ger Verhallen` + `item3.X-ABLabel:_$!<Father>!$_`** reads as
   `parents: [[Ger Verhallen]]`; an untouched sync keeps both lines byte-identical. Test: Task 2.
2. **Two people with the same name and a hint**: the hint picks the right note; without a hint the name is ambiguous
   and stays text. Test: Task 2.
3. **Removing one relationship from a 3.0 card** removes its `X-ABRELATEDNAMES` line and its `X-ABLabel`, not other
   groups' labels. Test: Task 3.
4. **A stored mapping where the owner renamed `children` to `kinderen`** gets labels added to that row and the new
   `partner` row appended, without renaming anything. Test: Task 1.
5. **A 3.0 card holding a plugin-written `RELATED…urn:uuid` line and no other difference** opens the review screen
   with the rewrite line, and Apply replaces it by the 3.0 form. Test: Task 3/4.

---

### Task 1: Mapping: labels, `partner`, anniversary label, stored-mapping migration

**Files:** `src/contacts/friendly/mapping.ts`, `src/context/sharedSettingsContext.ts` (call the migration on load),
`src/graph/graphModel.ts` (kind for `sweetheart` → partner if not covered), tests `tests/friendly/mapping.spec.ts`,
`tests/context.spec.ts`.

**Interfaces (produce):**
- `RelationRow` gains `labels: string[]` (first = written label). `FieldRow` gains optional `appleDateLabel?: string`
  (anniversary: `Anniversary`).
- `DEFAULT_MAPPING`: labels per the spec table; new row `relation('partner', ['sweetheart'], 'partner', true)` with
  labels `['Partner']`, placed right after `spouse`.
- `APPLE_BUILTIN_LABELS: ReadonlySet<string>` (lower-case: spouse, partner, child, parent, mother, father, brother,
  sister, friend, assistant, manager, anniversary).
- `labelText(raw: string): string[]` — `_$!<Spouse>!$_` → `['spouse']`; `Domestic-partner, Spouse` →
  `['domestic-partner', 'spouse']`; trims, lower-cases.
- `writeLabel(label: string): string` — built-in → `_$!<Label>!$_`, else the label as is.
- `migrateMapping(stored: MappingRow[]): MappingRow[]` — adds missing `labels` to relation rows from the default row
  with the same `types[0]`; appends default relation rows whose `types[0]` is absent (e.g. partner); adds
  `appleDateLabel` to the field row whose write key is `ANNIVERSARY`; never renames or removes; idempotent.
- [ ] Tests: `label text from apple and plain labels`; `write label`; `migration adds partner and labels`;
  `migration keeps renamed rows`; `migration is idempotent`; `validateMapping accepts the new rows`.
- [ ] Implement; full suite + build + e2e; commit `feat(relations): labels for relationships and a partner row`.

### Task 2: Reading every form

**Files:** `src/contacts/friendly/translate.ts`, `src/contacts/friendly/mapping.ts` (`rowForLine(line, rows,
label?)`), `src/contacts/friendly/relations.ts` (`RelationContext.displayName`), its implementers
(`ObsidianRelationContext` in `src/contacts/obsidianNotes.ts`, test fakes), tests `tests/friendly/toFriendly.spec.ts`
+ fixture `tests/fixtures/davx5V3.vcf` (relationships with built-in and plain labels, `Domestic-partner, Spouse`,
an unlabeled `TYPE=other`, an anniversary `X-ABDATE`).

**Interfaces:** `toFriendly` builds `group → label` from `X-ABLABEL` lines first and passes the label to
`rowForLine`. Relation rows match `RELATED` by type (today) or `X-ABRELATEDNAMES` by label. The anniversary row
matches `X-ABDATE` with its `appleDateLabel`. Relation value: `X-FRIENDLY-UID` hint → `ctx.uidToName(hint)` when it
resolves, else the value as a name (`VALUE=text` rule) or the `urn:uuid:` rule (today).
- [ ] Tests: the Review Focus 1 and 2 cases; every row of the label table; unlabeled/unknown label unmapped; 4.0
  `RELATED;VALUE=text` with and without hint; anniversary from `X-ABDATE` incl. Apple year-less.
- [ ] Implement; full suite + build + e2e; commit `feat(relations): read relationships in every vCard form`.

### Task 3: Writing per version, and the legacy rewrite

**Files:** `src/contacts/friendly/patch.ts` (`addRelated`, `patchRelation`, anniversary in `patchField`/`patchDate`,
next free `itemN`), `src/contacts/friendly/dates.ts` if needed, tests `tests/friendly/patch.spec.ts`.

**Interfaces:**
- 3.0: new relation → `itemN.X-ABRELATEDNAMES[;X-FRIENDLY-UID=<uid>]:<escaped display name>` + `itemN.X-ABLabel:<writeLabel(row.labels[0])>`;
  new anniversary → `itemN.X-ABDATE:<date>` + `itemN.X-ABLabel:_$!<Anniversary>!$_`.
- 4.0: `RELATED;TYPE=<row.types[0]>;VALUE=text[;X-FRIENDLY-UID=<uid>]:<escaped display name>`.
- Ambiguous/unknown targets: name only, no hint (warning as today).
- Removal removes the line and the label of its group (existing `removeLine`).
- `patch(…, { rewriteLegacyRelations: true })`: on a 3.0 card, every `RELATED` line becomes the 3.0 form (same
  person, same row). `needsLegacyRewrite(lines): boolean` exported for prepare.
- [ ] Tests: per version add/remove/replace; Review Focus 3; legacy rewrite; untouched lines byte-identical; item
  numbers never collide with existing groups.
- [ ] Implement; full suite + build + e2e; commit `feat(relations): write relationships in the card's own form`.

### Task 4: Review screen and sync for the legacy rewrite

**Files:** `src/sync/syncContact.ts` (prepare flags `rewriteRelations` when `needsLegacyRewrite`; apply passes the
option), `src/sync/review.ts`/`syncFlow.ts` (no rows but rewrite → review opens with the info line; `isUpToDate`
false), `src/ui/modals/syncReviewModal.tsx` (info line, exact text from the spec), tests `tests/syncContact.spec.ts`,
`tests/syncFlow.spec.ts`.
- [ ] Tests: Review Focus 5; a rewrite together with normal rows; Cancel writes nothing.
- [ ] Implement; full suite + build + e2e; commit `feat(sync): rewrite old relationship lines on 3.0 cards`.

### Task 5: New cards follow the address book; choose the book on create

**Files:** `src/settings/settings.d.ts` (`Source.newCardVersion?: 'auto' | '3.0' | '4.0'`), `src/sync/sources.ts`
(`newCardVersion(source, versions: string[]): '3.0' | '4.0'` pure), `src/sync/adapters/carddavGeneric.ts` +
`src/util/vcard.ts` (`VCardMeta.version` from the listing; add `VERSION` to the REPORT props), `src/contacts/friendly/patch.ts`
(`newCard(props, rows, ctx, version)`), `src/sync/syncContact.ts` (create uses the target book's version),
`src/ui/settings/components/sourcesSettings.tsx` (dropdown "New contacts" + "Count card versions" button showing
`<n> × vCard 3.0, <m> × vCard 4.0`), `src/ui/modals/contactNameModal.tsx` + `src/ui/sidebar/components/SidebarRootView.tsx`
(address book dropdown; writes `source:`), tests `tests/sources.spec.ts`, `tests/friendly/patch.spec.ts`,
`tests/syncContact.spec.ts`.
- [ ] Tests: `automatic follows the majority`, `tie and empty use 3.0`, `explicit setting wins`; `new 3.0 card uses
  the 3.0 forms` (photo ENCODING=b, relationships, anniversary, year-less birthday); create picks the book's version.
- [ ] Implement; full suite + build + e2e; commit `feat(sources): new cards follow the address book's version`.

### Task 6: e2e, README, checklist

- [ ] e2e: a DAVx5-shaped 3.0 card round trip (read relationships/anniversary; add one in Obsidian; the card gets
  `X-ABRELATEDNAMES` + label; untouched lines identical) and the same for a 4.0 card.
- [ ] README: relationships on phones, `partner`, the new-contacts version, choosing the book on create; checklist items.
- [ ] Commit `test(e2e): relationships in vCard 3.0 and 4.0` and `docs: card versions`.
