/** Something added to a view that can be taken away again, such as the element `MarkdownView.addAction` returns. */
export interface Removable {
  remove(): void;
}

/**
 * Keeps at most one action per view. `reconcile` is told which views should have the action now: it adds the
 * action to those that lack it and removes it from the others, so calling it on every event never doubles an icon.
 */
export class ViewActionTracker<V, E extends Removable> {
  private readonly elements = new Map<V, E>();

  constructor(private readonly add: (view: V) => E) {}

  reconcile(wanted: Iterable<V>): void {
    const keep = new Set(wanted);
    for (const [view, element] of this.elements) {
      if (keep.has(view)) continue;
      element.remove();
      this.elements.delete(view);
    }
    for (const view of keep) {
      if (!this.elements.has(view)) this.elements.set(view, this.add(view));
    }
  }

  /** Removes every action, for unload. */
  clear(): void {
    this.reconcile([]);
  }
}
