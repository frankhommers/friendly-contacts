/**
 * Draws a people graph on a canvas: a d3-force simulation, d3-zoom for pan and zoom, d3-drag for nodes. Knows
 * nothing about notes; the view feeds it a graph and handles clicks.
 */

import { drag } from "d3-drag";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type ForceLink,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import { GRAPH_KINDS, kindColorVar } from "src/graph/graphColors";
import {
  carryPositions,
  edgeLabel,
  hitTest,
  hopDistances,
  initials,
  parallelOffsets,
  safeImageSrc,
} from "src/graph/graphLayout";
import { type Graph, type GraphEdge, type GraphNode, lodTier, type RelationKind } from "src/graph/graphModel";

interface SimNode extends SimulationNodeDatum, GraphNode {}

interface SimLink extends SimulationLinkDatum<SimNode> {
  edge: GraphEdge;
  offset: number;
}

interface DragSubject {
  node: SimNode;
  x: number;
  y: number;
}

export interface GraphRendererEvents {
  /** A click on a node (a plain click waits briefly, so a double-click does not also count as a click). */
  onNodeClick(node: GraphNode, event: MouseEvent): void;
  onNodeDoubleClick(node: GraphNode, event: MouseEvent): void;
}

const NODE_RADIUS = 14;
const CENTRE_RADIUS = 20;
const PARALLEL_SPACING = 26;
const DOUBLE_CLICK_WAIT = 250;
const CLICK_DISTANCE = 4;

type Colors = Record<RelationKind | "accent" | "node" | "border" | "text" | "muted" | "faint" | "background", string>;

export class GraphRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly win: Window;
  private readonly simulation: Simulation<SimNode, SimLink>;
  private readonly zoomBehavior: ZoomBehavior<HTMLCanvasElement, unknown>;
  private readonly resizeObserver: ResizeObserver;
  private readonly images = new Map<string, { img: HTMLImageElement; state: "loading" | "ok" | "broken" }>();
  private nodes: SimNode[] = [];
  private links: SimLink[] = [];
  private centre: string | undefined;
  private distances = new Map<string, number>();
  private transform: ZoomTransform = zoomIdentity;
  private width = 0;
  private height = 0;
  private frame = 0;
  private clickTimer = 0;
  private colors!: Colors;
  private font = "sans-serif";
  private destroyed = false;

  constructor(
    private readonly host: HTMLElement,
    private readonly events: GraphRendererEvents,
  ) {
    this.win = host.ownerDocument.defaultView ?? window;
    this.canvas = host.ownerDocument.createElement("canvas");
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", "People graph");
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");
    this.readStyle();

    this.simulation = forceSimulation<SimNode, SimLink>()
      .force("link", forceLink<SimNode, SimLink>().id((d) => d.id).distance(90))
      .force("charge", forceManyBody<SimNode>().strength(-300).distanceMax(800))
      .force("center", forceCenter(0, 0))
      .force("collide", forceCollide<SimNode>((d) => this.radius(d) + 8))
      .on("tick", () => this.requestDraw())
      .on("end", () => this.requestDraw());
    this.simulation.stop();

    const canvasSel = select<HTMLCanvasElement, unknown>(this.canvas);
    // Drag first: on a node it stops the event before zoom would pan.
    canvasSel.call(
      drag<HTMLCanvasElement, unknown, DragSubject | undefined>()
        .container(() => this.canvas)
        .clickDistance(CLICK_DISTANCE)
        .subject((event: { x: number; y: number }) => {
          const node = this.nodeAt(event.x, event.y);
          return node && { node, x: this.transform.applyX(node.x!), y: this.transform.applyY(node.y!) };
        })
        .on("start", (event: { active: number; subject: DragSubject }) => {
          if (!event.active) this.simulation.alphaTarget(0.3).restart();
          event.subject.node.fx = event.subject.node.x;
          event.subject.node.fy = event.subject.node.y;
        })
        .on("drag", (event: { x: number; y: number; subject: DragSubject }) => {
          event.subject.node.fx = this.transform.invertX(event.x);
          event.subject.node.fy = this.transform.invertY(event.y);
          this.requestDraw();
        })
        .on("end", (event: { active: number }) => {
          // The node keeps its fx/fy: it stays where it was dropped.
          if (!event.active) this.simulation.alphaTarget(0);
        }),
    );
    this.zoomBehavior = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.1, 4])
      .clickDistance(CLICK_DISTANCE)
      .on("zoom", (event: { transform: ZoomTransform }) => {
        this.transform = event.transform;
        this.requestDraw();
      });
    canvasSel.call(this.zoomBehavior).on("dblclick.zoom", null);

    this.canvas.addEventListener("click", this.onClick);
    this.canvas.addEventListener("dblclick", this.onDoubleClick);
    this.canvas.addEventListener("pointermove", this.onPointerMove);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
  }

  /** Draws `graph` around `centre`; nodes that were drawn before keep their place. */
  setGraph(graph: Graph, centre: string | undefined): void {
    const firstTime = this.nodes.length === 0;
    const previous = new Map(this.nodes.map((n) => [n.id, n] as const));
    const nodes: SimNode[] = graph.nodes.map((n) => ({ ...n }));
    const added = carryPositions(previous, nodes, graph.edges);
    if (firstTime && centre !== undefined) {
      const c = nodes.find((n) => n.id === centre);
      if (c && c.x === undefined) {
        c.x = 0;
        c.y = 0;
      }
    }
    const offsets = parallelOffsets(graph.edges);
    const links: SimLink[] = graph.edges.map((edge, i) => ({ source: edge.a, target: edge.b, edge, offset: offsets[i] }));
    const edgeKey = (e: GraphEdge) => `${e.a}\u0000${e.b}\u0000${e.kind}\u0000${e.labelFromA}`;
    const oldEdges = new Set(this.links.map((l) => edgeKey(l.edge)));
    const changed =
      added > 0 ||
      nodes.length !== previous.size ||
      links.length !== oldEdges.size ||
      links.some((l) => !oldEdges.has(edgeKey(l.edge)));

    this.nodes = nodes;
    this.links = links;
    this.centre = centre;
    this.distances = hopDistances(graph, centre);
    this.simulation.nodes(nodes);
    (this.simulation.force("link") as ForceLink<SimNode, SimLink>).links(links);
    if (firstTime || changed) this.simulation.alpha(firstTime ? 1 : 0.3).restart();
    this.requestDraw();
  }

  /** Forgets the drawn graph (when there is nothing to draw). */
  clear(): void {
    this.simulation.stop();
    this.nodes = [];
    this.links = [];
    this.simulation.nodes([]);
    (this.simulation.force("link") as ForceLink<SimNode, SimLink>).links([]);
    this.requestDraw();
  }

  /** The id a node had moves to `newId` (a renamed note), so its place is kept on the next `setGraph`. */
  renameNode(oldId: string, newId: string): void {
    const node = this.nodes.find((n) => n.id === oldId);
    if (node) node.id = newId;
  }

  /** Pans to the centre node at zoom 1 (to the middle of the drawing without a centre). */
  recenter(): void {
    const c = this.nodes.find((n) => n.id === this.centre);
    const t = zoomIdentity.translate(this.width / 2 - (c?.x ?? 0), this.height / 2 - (c?.y ?? 0));
    select<HTMLCanvasElement, unknown>(this.canvas).call(this.zoomBehavior.transform, t);
  }

  /** Pans so the centre node is in the middle, keeping the zoom. */
  focusCentre(): void {
    const c = this.nodes.find((n) => n.id === this.centre);
    if (c?.x === undefined || c.y === undefined) return;
    select<HTMLCanvasElement, unknown>(this.canvas).call(this.zoomBehavior.translateTo, c.x, c.y);
  }

  /** Reads the theme colours again (after a theme change). */
  refreshColors(): void {
    this.readStyle();
    this.requestDraw();
  }

  destroy(): void {
    this.destroyed = true;
    this.simulation.stop();
    this.simulation.on("tick", null).on("end", null);
    this.resizeObserver.disconnect();
    select(this.canvas).on(".zoom", null).on(".drag", null);
    this.canvas.removeEventListener("click", this.onClick);
    this.canvas.removeEventListener("dblclick", this.onDoubleClick);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    if (this.frame) this.win.cancelAnimationFrame(this.frame);
    this.win.clearTimeout(this.clickTimer);
    for (const { img } of this.images.values()) {
      img.onload = null;
      img.onerror = null;
    }
    this.images.clear();
    this.nodes = [];
    this.links = [];
    this.canvas.remove();
  }

  private readonly onClick = (event: MouseEvent) => {
    const node = this.nodeAtEvent(event);
    this.win.clearTimeout(this.clickTimer);
    if (!node) return;
    if (event.metaKey || event.ctrlKey) {
      this.events.onNodeClick(node, event);
      return;
    }
    this.clickTimer = this.win.setTimeout(() => this.events.onNodeClick(node, event), DOUBLE_CLICK_WAIT);
  };

  private readonly onDoubleClick = (event: MouseEvent) => {
    this.win.clearTimeout(this.clickTimer);
    const node = this.nodeAtEvent(event);
    if (node) this.events.onNodeDoubleClick(node, event);
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    const node = this.nodeAtEvent(event);
    this.canvas.style.cursor = node ? "pointer" : "";
    const title = node?.name ?? "";
    if (this.canvas.title !== title) this.canvas.title = title;
  };

  private nodeAtEvent(event: MouseEvent): SimNode | undefined {
    const rect = this.canvas.getBoundingClientRect();
    return this.nodeAt(event.clientX - rect.left, event.clientY - rect.top);
  }

  /** The node under a point in canvas (CSS pixel) coordinates. */
  private nodeAt(px: number, py: number): SimNode | undefined {
    const [x, y] = this.transform.invert([px, py]);
    // At least 8 screen pixels, so small dots stay easy to hit.
    return hitTest(this.nodes, x, y, (n) => Math.max(this.radius(n), 8 / this.transform.k));
  }

  private radius(node: GraphNode): number {
    return node.id === this.centre ? CENTRE_RADIUS : NODE_RADIUS;
  }

  private resize(): void {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    if (width === this.width && height === this.height) return;
    const dpr = this.win.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    // Keep the middle of the drawing in the middle of the view.
    const dx = (width - this.width) / 2;
    const dy = (height - this.height) / 2;
    this.width = width;
    this.height = height;
    const k = this.transform.k;
    select<HTMLCanvasElement, unknown>(this.canvas).call(this.zoomBehavior.translateBy, dx / k, dy / k);
    this.requestDraw();
  }

  private readStyle(): void {
    const style = this.win.getComputedStyle(this.host);
    const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
    const kinds = Object.fromEntries(GRAPH_KINDS.map((k) => [k, read(kindColorVar(k), "#888888")])) as Record<RelationKind, string>;
    this.colors = {
      ...kinds,
      accent: read("--interactive-accent", "#7f6df2"),
      node: read("--background-secondary", "#f2f3f5"),
      border: read("--background-modifier-border", "#cccccc"),
      text: read("--text-normal", "#222222"),
      muted: read("--text-muted", "#666666"),
      faint: read("--text-faint", "#999999"),
      background: read("--background-primary", "#ffffff"),
    };
    this.font = read("--font-interface", "sans-serif");
  }

  private requestDraw(): void {
    if (this.frame || this.destroyed) return;
    this.frame = this.win.requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private image(src: string): HTMLImageElement | undefined {
    let entry = this.images.get(src);
    if (!entry) {
      const img = new Image();
      const created = { img, state: "loading" as "loading" | "ok" | "broken" };
      img.referrerPolicy = "no-referrer";
      img.onload = () => {
        created.state = "ok";
        this.requestDraw();
      };
      img.onerror = () => {
        created.state = "broken";
        this.requestDraw();
      };
      img.src = src;
      entry = created;
      this.images.set(src, entry);
    }
    return entry.state === "ok" ? entry.img : undefined;
  }

  private draw(): void {
    const ctx = this.ctx;
    if (!ctx || this.destroyed) return;
    const dpr = this.win.devicePixelRatio || 1;
    const { k, x, y } = this.transform;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * x, dpr * y);

    const tier = lodTier(k);
    const labels = tier !== "dots";
    // Text keeps its screen size when zoomed out and grows when zoomed in.
    const textScale = 1 / Math.min(k, 1);
    const colors = this.colors;

    // Edges: a straight line, or a curve when two people have more than one relation.
    const mids: { x: number; y: number; text: string; color: string }[] = [];
    ctx.lineWidth = Math.max(1.5, 1 / k);
    for (const link of this.links) {
      const s = link.source as SimNode;
      const t = link.target as SimNode;
      if (s.x === undefined || s.y === undefined || t.x === undefined || t.y === undefined) continue;
      const color = colors[link.edge.kind];
      // The bend is relative to the line from the pair's smaller id to its larger id (see parallelOffsets).
      const [p, q] = s.id < t.id ? [s, t] : [t, s];
      const dx = q.x! - p.x!;
      const dy = q.y! - p.y!;
      const length = Math.hypot(dx, dy) || 1;
      const bend = link.offset * PARALLEL_SPACING * 2;
      const cx = (s.x + t.x) / 2 + (-dy / length) * bend;
      const cy = (s.y + t.y) / 2 + (dx / length) * bend;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      if (bend === 0) ctx.lineTo(t.x, t.y);
      else ctx.quadraticCurveTo(cx, cy, t.x, t.y);
      ctx.stroke();
      if (labels) {
        // The middle of the quadratic curve (t = 0.5).
        mids.push({
          x: (s.x + 2 * cx + t.x) / 4,
          y: (s.y + 2 * cy + t.y) / 4,
          text: edgeLabel(link.edge, this.distances),
          color,
        });
      }
    }

    if (labels) {
      const size = 10 * textScale;
      ctx.font = `${size}px ${this.font}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const mid of mids) {
        const w = ctx.measureText(mid.text).width + 6 * textScale;
        ctx.fillStyle = colors.background;
        ctx.fillRect(mid.x - w / 2, mid.y - size * 0.7, w, size * 1.4);
        ctx.fillStyle = mid.color;
        ctx.fillText(mid.text, mid.x, mid.y);
      }
    }

    // Nodes.
    for (const node of this.nodes) {
      if (node.x === undefined || node.y === undefined) continue;
      const r = this.radius(node);
      const isCentre = node.id === this.centre;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
      ctx.setLineDash(node.ghost ? [4, 3] : []);
      if (tier === "dots") {
        ctx.fillStyle = node.ghost ? colors.background : isCentre ? colors.accent : colors.muted;
        ctx.fill();
        if (node.ghost) {
          ctx.strokeStyle = colors.faint;
          ctx.lineWidth = Math.max(1.5, 1 / k);
          ctx.stroke();
        }
        continue;
      }
      ctx.fillStyle = node.ghost ? colors.background : colors.node;
      ctx.fill();
      const src = tier === "photos" && !node.ghost ? safeImageSrc(node.photo) : undefined;
      const img = src !== undefined ? this.image(src) : undefined;
      if (img) {
        ctx.save();
        ctx.clip();
        const side = Math.min(img.naturalWidth, img.naturalHeight) || 1;
        // The middle square of the photo, filling the circle.
        ctx.drawImage(
          img,
          (img.naturalWidth - side) / 2,
          (img.naturalHeight - side) / 2,
          side,
          side,
          node.x - r,
          node.y - r,
          2 * r,
          2 * r,
        );
        ctx.restore();
      } else {
        ctx.fillStyle = node.ghost ? colors.faint : colors.text;
        ctx.font = `600 ${r * 0.8}px ${this.font}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(initials(node.name), node.x, node.y + 0.5);
      }
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
      ctx.strokeStyle = isCentre ? colors.accent : node.ghost ? colors.faint : colors.border;
      ctx.lineWidth = isCentre ? 3 : 1.5;
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Names below the nodes, on top of everything else.
    if (labels) {
      const size = 12 * textScale;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (const node of this.nodes) {
        if (node.x === undefined || node.y === undefined) continue;
        ctx.font = `${node.ghost ? "italic " : ""}${size}px ${this.font}`;
        ctx.fillStyle = node.ghost ? colors.faint : colors.text;
        ctx.fillText(node.name, node.x, node.y + this.radius(node) + 3 * textScale);
      }
    }
  }
}
