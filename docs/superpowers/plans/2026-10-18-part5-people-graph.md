# Part 5: People Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A view that draws people and how they relate, centred on "me" or on a contact, inspired by Nametag's network
graph (idea only, no code).

**Architecture:**
- Pure graph building in `src/graph/` (no `obsidian` imports): contacts + relation snapshots → nodes and edges, kinds,
  mirror dedupe, neighbourhood by depth, node cap, level of detail.
- An Obsidian-facing collector turns contact notes into graph input.
- An `ItemView` renders the graph on a canvas with a d3-force simulation, d3-zoom and d3-drag.

**Tech Stack:** TypeScript, Obsidian API (`ItemView`, `metadataCache`), d3-force / d3-zoom / d3-drag / d3-selection
(ISC licence), vitest.

**Spec:** `docs/superpowers/specs/2026-10-18-sources-review-folders-design.md`, Part 5.

## Global Constraints

- Commits: never add `Co-Authored-By` or mention any LLM/agent.
- No code from Nametag (AGPL); this plugin is MIT. d3 modules only (ISC).
- Business logic outside `.tsx`/view classes; the view calls `src/graph/*`.
- `src/graph/*.ts` except `vaultGraph.ts` import nothing from `obsidian` or `src/context/*`.
- Works on mobile (no network access needed to draw).
- Test: `npm run test:run`. Build: `npm run build`. Both pass at the end of every task.
- Values from the spec: default depth 2; depth choices 1, 2, 3, 4, everyone; max 500 nodes; level of detail: dots when
  zoom < 0.6, names for 0.6 ≤ zoom < 1.2, photos at zoom ≥ 1.2.
- Kinds by the mapping row's vCard type (`row.types[0]`), never by property name: partner (`spouse`), family (`child`,
  `parent`, `sibling`, `kin`), friends (`friend`), work (`colleague`, `co-worker`), other (all remaining types).

## Review Focus

1. **A relation to a person without a note** (link that does not resolve) → a dashed ghost node named after the link
   text, never dropped, never merged with a same-named note elsewhere. Test: Task 1 `unresolved link becomes a ghost`.
2. **One-sided relation** (Jan `children: [[Sem]]`, Sem has no `parents`) → still one edge. Mirrored pair → one edge,
   not two. Test: Task 1 `mirrored pair is one edge`, `one-sided relation is an edge`.
3. **Two different relations between the same two people** (colleagues and friends) → two edges. Test: Task 1
   `different kinds between the same pair are two edges`.
4. **"This is me" points at a deleted contact or a UID no note has** → falls back to the active contact, else
   everyone, with no error. Test: Task 2 `centre falls back when me is missing`.
5. **A renamed relation property** (`children` renamed to `kids`) keeps the family colour and the `child` label.
   Test: Task 1 `kind follows the vcard type, not the property`.

---

### Task 0: Small relationship follow-ups from the Part 4 review

**Files:** `src/ui/modals/addRelationshipModal.ts`, `src/contacts/relationEdit.ts`, tests in `tests/addRelationship.spec.ts`
/ `tests/relationEdit.spec.ts`.

- The "already has a spouse" warning (ConfirmModal text and Notice) only appears when mirroring is on for this device
  (`mirrorRelationsOnThisDevice(app)`); otherwise nothing would have been mirrored anyway. Test the pure decision.
- Replacing a same-name grey entry in a single relation that was hand-edited into a list must not silently drop the
  other entries: ask with the existing ConfirmModal (`Replace <list> with <name> as <property>?`). Test.
- [ ] TDD; full suite + build; commit `fix(relations): warnings and replacements that match what will happen`.

### Task 1: Graph model

**Files:**
- Create: `src/graph/graphModel.ts`
- Test: `tests/graph/graphModel.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export type RelationKind = 'partner' | 'family' | 'friends' | 'work' | 'other';
  export interface GraphContact { id: string; name: string; photo?: string; snapshot: RelationSnapshot } // id = note path
  export interface GraphNode { id: string; name: string; photo?: string; ghost: boolean }        // ghost id = `ghost:<link text>`
  export interface GraphEdge { a: string; b: string; kind: RelationKind; labelFromA: string; labelFromB?: string }
  export interface Graph { nodes: GraphNode[]; edges: GraphEdge[] }
  export function relationKind(row: RelationRow): RelationKind;
  export function buildGraph(contacts: GraphContact[], rows: MappingRow[]): Graph;
  export function neighbourhood(graph: Graph, centre: string | undefined, depth: number | 'all', kinds: Set<RelationKind>): { graph: Graph } | { tooMany: number };
  export function lodTier(zoom: number): 'dots' | 'names' | 'photos';
  ```
  - `buildGraph`: snapshot entries that equal a contact id are edges to that note; other entries are ghost nodes
    (`ghost:<text>`). `labelFromA` is the vCard type of the row used on A's side (Jan `children: Sem` → edge a=Jan,
    b=Sem, `labelFromA: 'child'`, meaning "Sem is Jan's child"). If B lists A under the row's `mirror` property, that
    entry is the same edge and fills `labelFromB` (`'parent'`). Different rows between the same pair are separate
    edges.
  - `neighbourhood`: edges whose kind is not in `kinds` are ignored; breadth-first from `centre` up to `depth` steps;
    `centre` undefined or `'all'` depth → the whole (filtered) graph; more than 500 nodes → `{ tooMany: <count> }`.
  - `lodTier` per Global Constraints.
- Consumes: `RelationSnapshot` (`src/contacts/friendly/relations.ts`), `MappingRow`, `RelationRow`, `DEFAULT_MAPPING`.

- [ ] **Step 1: Write the failing tests** (with `DEFAULT_MAPPING`): `mirrored pair is one edge` (labels `child` /
  `parent`); `one-sided relation is an edge` (`labelFromB` undefined); `different kinds between the same pair are two
  edges`; `unresolved link becomes a ghost`; `kind follows the vcard type, not the property` (row renamed to `kids` via
  `renameRow`); `spouse is partner, friend is friends, colleague is work, neighbor is other`; `depth 1 and 2 from a
  centre`; `filtered kinds break paths`; `more than 500 nodes is too many` (501 contacts in a chain, depth `'all'`);
  `lod tiers at 0.59, 0.6, 1.19, 1.2`.
- [ ] **Step 2: Run** `npm run test:run -- tests/graph` → FAIL.
- [ ] **Step 3: Implement** in `graphModel.ts`.
- [ ] **Step 4: Run** `npm run test:run`, `npm run build` → PASS.
- [ ] **Step 5: Commit** `feat(graph): people graph model`

### Task 2: Graph input from the vault and "This is me"

**Files:**
- Create: `src/graph/vaultGraph.ts`
- Modify: `src/settings/settings.d.ts`, `src/settings/setting.ts`, `src/context/sharedSettingsContext.ts`
  (`meUid: string`, default `''`), the settings screen (a "This is me" row with a contact picker and Clear)
- Test: `tests/graph/vaultGraph.spec.ts`

**Interfaces:**
- Produces:
  - `graphContacts(app: App, rows: MappingRow[]): GraphContact[]` — every contact note (`contactNotes(app)`), `name`
    = the contact's display name as the rest of the plugin computes it (`contactDisplayName` in
    `src/contacts/layoutNotes.ts`: `name` property, else the folder/file name — never `index`); `photo` = `photo` property when it is a data URI or http(s) URL
    (bare base64 becomes `data:image/jpeg;base64,…`); snapshot = `relationSnapshot(frontmatter, rows, resolve)` with
    `resolve` = `getFirstLinkpathDest(linkpath, file.path)?.path` when that file is a contact note.
  - `graphCentre(app: App, meUid: string, activePath: string | undefined): string | undefined` — the note whose UID is
    `meUid`; else `activePath` when it is a contact note; else undefined (everyone).
  - Settings picker: `FuzzySuggestModal` over contact notes; stores the chosen note's UID (a note without UID gets one
    through the same path the UID processor uses, or the picker skips notes without UID — builder's call, recorded).
- [ ] **Step 1: Write the failing tests** with a fake app (pattern from existing specs that fake `metadataCache`):
  `collects names, photos and resolved links`; `centre is me`; `centre falls back when me is missing`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** full suite + build → PASS.
- [ ] **Step 5: Commit** `feat(graph): collect the graph from contact notes and add "This is me"`

### Task 3: The people graph view

**Files:**
- Create: `src/ui/graph/peopleGraphView.ts`, `src/ui/graph/graphRenderer.ts`, `src/graph/graphColors.ts`
- Modify: `package.json` (d3-force, d3-zoom, d3-drag, d3-selection and their `@types`), `src/main.ts` (register view,
  commands, ribbon), `src/util/constants.ts` (`PEOPLE_GRAPH_VIEW = { type: 'friendly-contacts-people-graph', name:
  'People graph', icon: 'network' }`), `src/ui/sidebar/components/ContactView.tsx` (a "Graph" button), `styles.css`
- Test: `tests/graph/graphColors.spec.ts`

**Interfaces:**
- Consumes: Task 1 (`buildGraph`, `neighbourhood`, `lodTier`, `RelationKind`), Task 2 (`graphContacts`, `graphCentre`).
- Produces:
  - `kindColorVar(kind: RelationKind): string` in `graphColors.ts` — an Obsidian theme variable per kind
    (`--color-pink` partner, `--color-orange` family, `--color-green` friends, `--color-blue` work, `--text-faint`
    other); the renderer reads it with `getComputedStyle`.
  - `PeopleGraphView extends ItemView` with state `{ centre?: string; depth: number | 'all'; kinds: RelationKind[] }`
    (persisted via `getState`/`setState`). Toolbar: depth select (1, 2, 3, 4, Everyone; default 2), one toggle pill per
    kind, Recenter button. A `tooMany` result shows `Too many people to draw (<n>). Choose a smaller depth.`
  - Renderer: canvas sized to the view (ResizeObserver); d3-force (link, many-body, center, collide); nodes as circles
    with photo (clipped) or initials, ghost nodes dashed; edges coloured by kind, label drawn at the middle at the
    `names` and `photos` tiers using the label as seen from the end nearer the centre (`labelFromA`/`labelFromB`);
    d3-zoom for pan/zoom; d3-drag for nodes (dragged node stays where dropped).
  - Interaction: click a node → it becomes the centre; double-click or Mod-click → open the note
    (`app.workspace.openLinkText(path, '')`); click a ghost → if sync is available and `remoteCardFor` (src/contacts/relationEdit.ts) finds exactly one
    server card for the ghost's name, a ConfirmModal `Import <name>?` imports it via `importFromServer`
    (src/ui/modals/importContactModal.ts); otherwise a Notice `<name> has no note.`
  - Live update: `metadataCache.on('changed')` for contact notes, debounced 500 ms, rebuilds the graph keeping the
    positions of existing nodes.
  - Commands: `friendly-contacts-people-graph` "Open people graph" (centre from `graphCentre`), and
    `friendly-contacts-people-graph-contact` "Open people graph for this contact" (active contact note; Notice when the
    active file is not a contact). Ribbon icon `network` → "Open people graph".
- [ ] **Step 1: Write the failing test** `tests/graph/graphColors.spec.ts`: one variable per kind, all distinct.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** the view and renderer. **Step 4: Run** full suite + build → PASS.
- [ ] **Step 5: Manual check** in the dev vault if available (`npm run dev`), else describe in the report what was
  verified by build only.
- [ ] **Step 6: Commit** `feat(graph): people graph view`
