import { ViewActionTracker } from 'src/ui/viewActionTracker';
import { describe, expect, it } from 'vitest';

type Icon = { view: string; removed: boolean; remove(): void };

function setup() {
  const icons: Icon[] = [];
  const tracker = new ViewActionTracker<string, Icon>((view) => {
    const icon: Icon = { view, removed: false, remove() { this.removed = true; } };
    icons.push(icon);
    return icon;
  });
  const live = () => icons.filter((i) => !i.removed).map((i) => i.view);
  return { tracker, icons, live };
}

describe('ViewActionTracker', () => {
  it('adds an action to each wanted view', () => {
    const { tracker, live } = setup();
    tracker.reconcile(['a', 'b']);
    expect(live()).toEqual(['a', 'b']);
  });

  it('never adds a second action to the same view', () => {
    const { tracker, icons, live } = setup();
    tracker.reconcile(['a']);
    tracker.reconcile(['a']);
    tracker.reconcile(['a', 'b']);
    tracker.reconcile(['b', 'a', 'a']);
    expect(icons).toHaveLength(2);
    expect(live()).toEqual(['a', 'b']);
  });

  it('removes the action from a view that is no longer wanted, and only from that view', () => {
    const { tracker, live } = setup();
    tracker.reconcile(['a', 'b']);
    tracker.reconcile(['b']);
    expect(live()).toEqual(['b']);
  });

  it('adds the action again when a view becomes wanted again', () => {
    const { tracker, icons, live } = setup();
    tracker.reconcile(['a']);
    tracker.reconcile([]);
    expect(live()).toEqual([]);
    tracker.reconcile(['a']);
    expect(icons).toHaveLength(2);
    expect(live()).toEqual(['a']);
  });

  it('clear removes every action, and a later reconcile starts over', () => {
    const { tracker, live } = setup();
    tracker.reconcile(['a', 'b']);
    tracker.clear();
    expect(live()).toEqual([]);
    tracker.reconcile(['b']);
    expect(live()).toEqual(['b']);
  });
});
