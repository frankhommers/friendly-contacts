# Sync all: one worklist of every contact that differs

Date: 2026-10-23. Status: design, agreed in chat with the owner (layout B of three sketches).

## Why

Today Sync works one contact at a time ("Sync this contact", the review modal). The owner wants to see what needs to
happen across all contacts at once: "ik wil gewoon kijken wat er moet gebeuren over al mijn contacten heen". Not one
direction for everything: per difference they decide, as in today's review; what Sync already knows is preselected.

## What it is

A worklist in its own Obsidian tab (an `ItemView`, not a modal), opened by a command "Sync all contacts" and a button
in the contacts sidebar. Layout B:

- **Left:** the contacts that differ, one row each, with a badge: from the phone (server side changed), from Obsidian
  (note changed), conflict (at least one row needs a choice), or new card (note never synced). Contacts already in sync
  are not listed; a line at the top counts them ("142 up to date").
- **Right:** the review of the selected contact. This is today's review content (`SyncReviewContent` in
  `src/ui/modals/syncReviewModal.tsx`), reused, not redesigned: same table, preselections, conflict handling,
  "Also changes", rename offer, info lines (relationships rewritten, note links, damaged photo), import of a
  server-only person. Owner: "Hergebruik code"; improving the review table itself is a later, separate job.
- Under the right side: **Apply** (this contact), **Previous**, **Next**.
- At the bottom: "<n> of <m> done" and **Apply all that are ready**: applies every listed contact whose choices are all
  made (no open conflict), each with the choices currently shown for it (preselections plus anything the owner changed)
  and its rename offer as currently ticked. Contacts with an open conflict are skipped and stay in the list. **New
  cards are skipped too**: a note that was never synced is only sent with its own Apply (owner agreed: creating many
  cards on the phone in one click is the one thing that is hard to undo). The count on the button excludes them.
- A contact that was applied is ticked off (greyed, struck through) and stays in the list until the next scan.
- Everything is shown, including differences Sync is sure about (owner: "Alles").

## Which contacts

- Every contact note (`contactNotes`) is scanned.
- **Only in Obsidian** (no card yet): listed as a new card, can be sent to the server like a first Sync today
  (owner: "moeten naar de andere kant mogen").
- **Only on the server** (card without note): not listed (owner: "Andersom hoeft niet"). Importing stays as it is.
- **Opt-out flag** (owner asked for one): a note with `sync: false` in its frontmatter is never synced: not listed by
  Sync all, and "Sync this contact" refuses with a Notice saying why. *(My call: the property name `sync` and that it
  also stops the single-contact Sync; the owner asked for "a flag to prevent this".)*
- **Cannot be synced** (Sync refuses or fails for it today: needs Convert, unknown `source:`, a card not found on the
  server, a book that cannot be searched, …): listed in a separate group at the bottom with the reason, no actions.
  *(My call: nothing is hidden.)*

## How it works (reuse)

The per-contact pipeline stays the single source of truth: `chooseSource` → `prepareSync` → review → `applySync`
(`src/sync/syncFlow.ts`, `src/sync/syncContact.ts`, wired in `src/sync/sync.ts`). Sync all runs the same steps per
contact; it does not get its own merge logic.

- **Scan:** for each note, choose the book and prepare (no writes before Apply, as today; the existing exception —
  storing the base when both sides agree — still applies). The result per note is up to date / review / refused / failed.
  Show progress while scanning; the list fills as results come in.
- **Apply (one contact or all ready):** `applySync` with the choices, exactly as the modal's Apply. A stale result
  (note or card changed since the scan) re-prepares that contact and shows it again in the list (as the modal reopens
  today), never applies old choices to new data.
- The "one Sync per note at a time" guard (`running` in `src/sync/sync.ts`) covers Sync all too, but only while a
  note is being scanned or applied, not for as long as it sits in the list. *(My call: a single Sync of a listed
  contact meanwhile just makes the tab's result stale, which the staleness check above handles.)*
- **Scan again** button: rescans everything.

## Goals

- One place to see and decide every difference across all contacts.
- Same safety as today's single Sync: same preselections, same staleness checks, nothing written before Apply.

## Non-goals

- Redesigning the review table (later, maybe; owner: "Kunnen we het later als het moet ineens oppakken").
- Listing or importing server-only cards.
- One-direction bulk actions ("everything from the phone").

## Anti-goals

- A second merge implementation that can disagree with the single-contact Sync.
- Applying choices made on stale data.
- Anything silently skipped: refused and failed contacts are visible with their reason.

## Left to the builder

- How the scan finds cards efficiently (today `locateCard` searches every active book per UID; with a few hundred
  contacts, listing each book once and reusing it is fine as long as the result is the same).
- Concurrency of the scan, progress display, keyboard navigation, exact styling (follow the sidebar and review CSS).
- Where exactly the sidebar button goes.
- How the review content is shared between the modal and the tab (extracting a component is fine).
- What happens to the list when the owner edits a note while the tab is open (rescan of that contact on Apply is
  required; live updates are optional).
