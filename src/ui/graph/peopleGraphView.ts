/** The people graph view: a toolbar (depth, kinds, open note, recenter) above a canvas drawn by GraphRenderer. */

import { type App, debounce, ItemView, Keymap, Notice, setIcon, TFile, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { isInside, normalizeFolder } from "src/contacts/moveContacts";
import { contactNotes, remoteContacts, type RemoteContact } from "src/contacts/obsidianNotes";
import { ghostAction } from "src/contacts/relationEdit";
import { getSettings, settings as settingsSignal } from "src/context/sharedSettingsContext";
import { GRAPH_KINDS, kindColorVar } from "src/graph/graphColors";
import { DEPTH_CHOICES, type GraphViewState, keptCentre, normalizeGraphState } from "src/graph/graphLayout";
import { buildGraph, ghostTarget, type GraphNode, neighbourhood, type RelationKind } from "src/graph/graphModel";
import { graphCentre, graphContacts } from "src/graph/vaultGraph";
import { isSyncAvailable } from "src/sync/adapters";
import { ConfirmModal } from "src/ui/modals/confirmModal";
import { importFromServer } from "src/ui/modals/importContactModal";
import { GraphRenderer } from "src/ui/graph/graphRenderer";
import { PEOPLE_GRAPH_VIEW } from "src/util/constants";
import { cleanUid } from "src/util/vcard";

const LIVE_UPDATE_DELAY = 500;

const KIND_LABEL: Record<RelationKind, string> = {
  partner: "Partner",
  family: "Family",
  friends: "Friends",
  work: "Work",
  other: "Other",
};

/** In the contacts folder or below it (`Contacts` does not contain `Contacts old/Jan.md`). */
const inContactsFolder = (path: string): boolean => isInside(path, normalizeFolder(getSettings().contactsFolder));

/** What a change of these settings changes in the graph: the contacts, their relations, and "me". */
const graphSettingsKey = (value: { contactsFolder: string; meUid: string; friendly: { mapping: unknown } }): string =>
  JSON.stringify([value.contactsFolder, value.meUid, value.friendly.mapping]);

export class PeopleGraphView extends ItemView {
  private state: GraphViewState = normalizeGraphState(undefined);
  private renderer: GraphRenderer | undefined;
  private depthSelect: HTMLSelectElement | undefined;
  private openButton: HTMLButtonElement | undefined;
  private readonly pills = new Map<RelationKind, HTMLElement>();
  private messageEl: HTMLElement | undefined;
  private canvasHost: HTMLElement | undefined;
  private firstDraw = 0;
  private ghostBusy = false;
  /** A refresh was skipped while the view was hidden; `focus`: it was to pan to the centre too. */
  private stale: { focus: boolean } | undefined;
  private readonly refreshSoon = debounce(() => this.refresh(), LIVE_UPDATE_DELAY, true);

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return PEOPLE_GRAPH_VIEW.type;
  }

  getDisplayText(): string {
    return PEOPLE_GRAPH_VIEW.name;
  }

  getIcon(): string {
    return PEOPLE_GRAPH_VIEW.icon;
  }

  getState(): Record<string, unknown> {
    const state: Record<string, unknown> = { ...super.getState(), depth: this.state.depth, kinds: [...this.state.kinds] };
    if (this.state.centre !== undefined) state.centre = this.state.centre;
    return state;
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    this.state = normalizeGraphState(state);
    this.syncToolbar();
    window.clearTimeout(this.firstDraw);
    this.refreshSoon.cancel();
    this.refresh(true);
    await super.setState(state, result);
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("friendly-graph-view");

    const toolbar = root.createDiv({ cls: "friendly-graph-toolbar" });
    const depthLabel = toolbar.createEl("label", { cls: "friendly-graph-depth", text: "Depth " });
    const select = depthLabel.createEl("select", { cls: "dropdown" });
    for (const depth of DEPTH_CHOICES) {
      select.createEl("option", { value: String(depth), text: depth === "all" ? "Everyone" : String(depth) });
    }
    this.registerDomEvent(select, "change", () => {
      this.state.depth = select.value === "all" ? "all" : Number(select.value);
      this.changed();
    });
    this.depthSelect = select;

    const pills = toolbar.createDiv({ cls: "friendly-graph-pills" });
    for (const kind of GRAPH_KINDS) {
      const pill = pills.createEl("button", { cls: "friendly-graph-pill" });
      pill.style.setProperty("--friendly-graph-kind", `var(${kindColorVar(kind)})`);
      pill.createSpan({ cls: "friendly-graph-swatch" });
      pill.createSpan({ text: KIND_LABEL[kind] });
      this.registerDomEvent(pill, "click", () => {
        const on = new Set(this.state.kinds);
        if (on.has(kind)) on.delete(kind);
        else on.add(kind);
        this.state.kinds = GRAPH_KINDS.filter((k) => on.has(k));
        this.changed();
      });
      this.pills.set(kind, pill);
    }

    // On a phone there is no double-click: this (or a tap on the centre) opens the centre's note.
    const open = toolbar.createEl("button", { cls: "clickable-icon friendly-graph-open", attr: { "aria-label": "Open note" } });
    setIcon(open, "file-text");
    this.registerDomEvent(open, "click", () => {
      if (this.state.centre !== undefined) void this.app.workspace.openLinkText(this.state.centre, "");
    });
    this.openButton = open;

    const recenter = toolbar.createEl("button", { cls: "clickable-icon friendly-graph-recenter", attr: { "aria-label": "Recenter" } });
    setIcon(recenter, "locate-fixed");
    this.registerDomEvent(recenter, "click", () => this.renderer?.recenter());

    this.messageEl = root.createDiv({ cls: "friendly-graph-message" });
    this.messageEl.hide();
    this.canvasHost = root.createDiv({ cls: "friendly-graph-canvas" });
    this.renderer = new GraphRenderer(this.canvasHost, {
      onNodeClick: (node, event) => this.nodeClicked(node, event),
      onNodeDoubleClick: (node) => this.openNode(node),
      onResize: () => this.refreshIfStale(),
    });
    this.syncToolbar();

    const { metadataCache, vault, workspace } = this.app;
    const isContactPath = (file: unknown): file is TFile => file instanceof TFile && file.extension === "md" && inContactsFolder(file.path);
    this.registerEvent(metadataCache.on("changed", (file) => {
      if (isContactPath(file)) this.refreshSoon();
    }));
    this.registerEvent(vault.on("delete", (file) => {
      if (isContactPath(file)) this.refreshSoon();
    }));
    this.registerEvent(vault.on("rename", (file, oldPath) => {
      const wasContact = oldPath.endsWith(".md") && inContactsFolder(oldPath);
      if (!wasContact && !isContactPath(file)) return;
      if (this.state.centre === oldPath) this.state.centre = file.path;
      this.renderer?.renameNode(oldPath, file.path);
      this.refreshSoon();
    }));
    this.registerEvent(workspace.on("css-change", () => this.renderer?.refreshColors()));
    // Before Obsidian has read every note the graph is incomplete: draw again once it has (the first time only).
    if (!(metadataCache as unknown as { resolved?: boolean }).resolved) {
      const ref = metadataCache.on("resolved", () => {
        metadataCache.offref(ref);
        this.refreshSoon();
      });
      this.registerEvent(ref);
    }
    let graphSettings = graphSettingsKey(getSettings());
    this.register(
      settingsSignal.subscribe((value) => {
        if (!value || graphSettingsKey(value) === graphSettings) return;
        graphSettings = graphSettingsKey(value);
        this.refreshSoon();
      }),
    );
    // A refresh skipped while hidden happens when the view shows again.
    this.registerEvent(workspace.on("active-leaf-change", () => this.refreshIfStale()));
    this.registerEvent(workspace.on("layout-change", () => this.refreshIfStale()));

    // setState usually follows right away and draws; otherwise draw with the defaults.
    this.firstDraw = window.setTimeout(() => workspace.onLayoutReady(() => this.refresh()), 0);
  }

  onResize(): void {
    this.refreshIfStale();
  }

  async onClose(): Promise<void> {
    window.clearTimeout(this.firstDraw);
    this.refreshSoon.cancel();
    this.renderer?.destroy();
    this.renderer = undefined;
    this.pills.clear();
    this.contentEl.empty();
  }

  /** A toolbar change: redraw and let Obsidian save the new state with the layout. */
  private changed(): void {
    this.syncToolbar();
    this.refresh();
    this.app.workspace.requestSaveLayout();
  }

  private syncToolbar(): void {
    if (this.depthSelect) this.depthSelect.value = String(this.state.depth);
    if (this.openButton) this.openButton.disabled = this.state.centre === undefined;
    for (const [kind, pill] of this.pills) {
      const on = this.state.kinds.includes(kind);
      pill.toggleClass("is-active", on);
      pill.setAttribute("aria-pressed", String(on));
    }
  }

  private refreshIfStale(): void {
    if (this.stale && this.containerEl.isShown()) this.refresh(this.stale.focus);
  }

  /**
   * Builds the graph from the contact notes and draws the part around the centre (`focus`: and pans to it). While
   * the view is hidden (a background tab) this waits until it shows.
   */
  private refresh(focus = false): void {
    const renderer = this.renderer;
    if (!renderer || !this.messageEl || !this.canvasHost) return;
    if (!this.containerEl.isShown()) {
      this.stale = { focus: focus || this.stale?.focus === true };
      return;
    }
    this.stale = undefined;
    const settings = getSettings();
    const rows = settings.friendly.mapping;
    const full = buildGraph(graphContacts(this.app, rows), rows);
    // A centre that is no longer a contact note (deleted) falls back to "me", else everyone.
    this.state.centre = keptCentre(this.state.centre, full, () => graphCentre(this.app, settings.meUid, undefined));
    this.syncToolbar();
    const result = neighbourhood(full, this.state.centre, this.state.depth, new Set(this.state.kinds));
    if ("tooMany" in result) {
      renderer.clear();
      this.showMessage(
        this.state.centre === undefined
          ? `Too many people to draw (${result.tooMany}). Set "This is me" in the settings or open the graph from a contact.`
          : `Too many people to draw (${result.tooMany}). Choose a smaller depth.`,
      );
      return;
    }
    if (result.graph.nodes.length === 0) {
      renderer.clear();
      this.showMessage("No people to draw.");
      return;
    }
    this.messageEl.hide();
    this.canvasHost.show();
    renderer.setGraph(result.graph, this.state.centre);
    if (focus) renderer.focusCentre();
  }

  private showMessage(text: string): void {
    this.messageEl?.setText(text);
    this.messageEl?.show();
    this.canvasHost?.hide();
  }

  private nodeClicked(node: GraphNode, event: MouseEvent): void {
    if (node.ghost) {
      void this.ghostClicked(node);
      return;
    }
    // A click on the centre opens its note: on a phone there is no double-click or Ctrl-click.
    if (Keymap.isModEvent(event) || node.id === this.state.centre) {
      this.openNode(node);
      return;
    }
    this.state.centre = node.id;
    this.refresh(true);
    this.app.workspace.requestSaveLayout();
  }

  private openNode(node: GraphNode): void {
    if (node.ghost) {
      void this.ghostClicked(node);
      return;
    }
    void this.app.workspace.openLinkText(node.id, "");
  }

  /**
   * A person without a note: open the note of their server card when there is one, offer to import the card when
   * not, else say there is no note.
   */
  private async ghostClicked(node: GraphNode): Promise<void> {
    if (this.ghostBusy) return;
    this.ghostBusy = true;
    // The address books may have to be read first; say so, the answer can take a moment.
    let lookingUp: Notice | undefined;
    try {
      if (isSyncAvailable()) {
        lookingUp = new Notice(`Looking up ${node.name}…`, 0);
        let remote: RemoteContact[] = [];
        try {
          remote = await remoteContacts();
        } catch (error) {
          console.error("Friendly Contacts: reading the address books failed", error);
        }
        lookingUp.hide();
        lookingUp = undefined;
        const uidKey = (uid: string) => cleanUid(uid).toLowerCase();
        const byUid = new Map<string, string>();
        for (const { file, uid } of contactNotes(this.app)) if (uid !== undefined) byUid.set(uidKey(uid), file.path);
        // Looked up by the link text, as the sidebar does; the name shown may be the link's label.
        const action = ghostAction(ghostTarget(node.id) ?? node.name, remote, (uid) => byUid.get(uidKey(uid)), "");
        if (action && "link" in action) {
          await this.app.workspace.openLinkText(action.link, "");
          return;
        }
        if (action && "import" in action) {
          const card = action.import;
          new ConfirmModal(this.app, `Import ${node.name}?`, "Import", () => void importFromServer(this.app, card)).open();
          return;
        }
      }
      new Notice(`${node.name} has no note.`);
    } finally {
      lookingUp?.hide();
      this.ghostBusy = false;
    }
  }
}

/** Opens the people graph (the open one, else a new tab) centred on `centre`; depth and kinds are kept. */
export async function openPeopleGraph(app: App, centre: string | undefined): Promise<void> {
  const existing = app.workspace.getLeavesOfType(PEOPLE_GRAPH_VIEW.type)[0];
  const leaf = existing ?? app.workspace.getLeaf("tab");
  const { centre: _old, ...kept } = normalizeGraphState(existing?.getViewState().state);
  const state: GraphViewState = centre === undefined ? kept : { ...kept, centre };
  await leaf.setViewState({ type: PEOPLE_GRAPH_VIEW.type, active: true, state: { ...state } });
  await app.workspace.revealLeaf(leaf);
}
