/** The people graph view: a toolbar (depth, kinds, recenter) above a canvas drawn by GraphRenderer. */

import { type App, debounce, ItemView, Keymap, Notice, setIcon, TFile, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { contactNotes, remoteContacts, type RemoteContact } from "src/contacts/obsidianNotes";
import { ghostAction } from "src/contacts/relationEdit";
import { getSettings } from "src/context/sharedSettingsContext";
import { isFileInFolder } from "src/file/file";
import { GRAPH_KINDS, kindColorVar } from "src/graph/graphColors";
import { DEPTH_CHOICES, type GraphViewState, normalizeGraphState } from "src/graph/graphLayout";
import { buildGraph, type GraphNode, neighbourhood, type RelationKind } from "src/graph/graphModel";
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

export class PeopleGraphView extends ItemView {
  private state: GraphViewState = normalizeGraphState(undefined);
  private renderer: GraphRenderer | undefined;
  private depthSelect: HTMLSelectElement | undefined;
  private readonly pills = new Map<RelationKind, HTMLElement>();
  private messageEl: HTMLElement | undefined;
  private canvasHost: HTMLElement | undefined;
  private firstDraw = 0;
  private ghostBusy = false;
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
    this.refresh();
    this.renderer?.focusCentre();
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

    const recenter = toolbar.createEl("button", { cls: "clickable-icon friendly-graph-recenter", attr: { "aria-label": "Recenter" } });
    setIcon(recenter, "locate-fixed");
    this.registerDomEvent(recenter, "click", () => this.renderer?.recenter());

    this.messageEl = root.createDiv({ cls: "friendly-graph-message" });
    this.messageEl.hide();
    this.canvasHost = root.createDiv({ cls: "friendly-graph-canvas" });
    this.renderer = new GraphRenderer(this.canvasHost, {
      onNodeClick: (node, event) => this.nodeClicked(node, event),
      onNodeDoubleClick: (node) => this.openNode(node),
    });
    this.syncToolbar();

    const { metadataCache, vault, workspace } = this.app;
    const isContactPath = (file: unknown): file is TFile => file instanceof TFile && file.extension === "md" && isFileInFolder(file);
    this.registerEvent(metadataCache.on("changed", (file) => {
      if (isContactPath(file)) this.refreshSoon();
    }));
    this.registerEvent(vault.on("delete", (file) => {
      if (isContactPath(file)) this.refreshSoon();
    }));
    this.registerEvent(vault.on("rename", (file, oldPath) => {
      const wasContact = oldPath.endsWith(".md") && oldPath.startsWith(getSettings().contactsFolder);
      if (!wasContact && !isContactPath(file)) return;
      if (this.state.centre === oldPath) this.state.centre = file.path;
      this.renderer?.renameNode(oldPath, file.path);
      this.refreshSoon();
    }));
    this.registerEvent(workspace.on("css-change", () => this.renderer?.refreshColors()));

    // setState usually follows right away and draws; otherwise draw with the defaults.
    this.firstDraw = window.setTimeout(() => workspace.onLayoutReady(() => this.refresh()), 0);
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
    for (const [kind, pill] of this.pills) {
      const on = this.state.kinds.includes(kind);
      pill.toggleClass("is-active", on);
      pill.setAttribute("aria-pressed", String(on));
    }
  }

  /** Builds the graph from the contact notes and draws the part around the centre. */
  private refresh(): void {
    const renderer = this.renderer;
    if (!renderer || !this.messageEl || !this.canvasHost) return;
    const settings = getSettings();
    const rows = settings.friendly.mapping;
    const full = buildGraph(graphContacts(this.app, rows), rows);
    // A centre that is no longer a contact note (deleted) falls back to "me", else everyone.
    if (this.state.centre !== undefined && !full.nodes.some((n) => n.id === this.state.centre && !n.ghost)) {
      this.state.centre = graphCentre(this.app, settings.meUid, undefined);
    }
    const result = neighbourhood(full, this.state.centre, this.state.depth, new Set(this.state.kinds));
    if ("tooMany" in result) {
      renderer.clear();
      this.showMessage(`Too many people to draw (${result.tooMany}). Choose a smaller depth.`);
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
    if (Keymap.isModEvent(event)) {
      this.openNode(node);
      return;
    }
    if (node.id === this.state.centre) return;
    this.state.centre = node.id;
    this.refresh();
    this.renderer?.focusCentre();
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
    try {
      if (isSyncAvailable()) {
        let remote: RemoteContact[] = [];
        try {
          remote = await remoteContacts();
        } catch (error) {
          console.error("Friendly Contacts: reading the address books failed", error);
        }
        const byUid = new Map<string, string>();
        for (const { file, uid } of contactNotes(this.app)) if (uid !== undefined) byUid.set(cleanUid(uid), file.path);
        const action = ghostAction(node.name, remote, (uid) => byUid.get(cleanUid(uid)), "");
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
