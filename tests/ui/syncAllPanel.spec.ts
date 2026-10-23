// @vitest-environment jsdom
import * as React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Choice, ReviewRow } from 'src/sync/review';
import type { Badge, SyncAllItem, SyncAllState } from 'src/sync/syncAll';
import type { PreparedSync } from 'src/sync/syncContact';
import type { ReviewRequest } from 'src/sync/syncFlow';
import { SyncAllPanel } from 'src/ui/syncAll/syncAllPanel';

const notices: string[] = [];

vi.mock('obsidian', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Modal: class {},
  Notice: class {
    constructor(message: string) {
      notices.push(message);
    }
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const conflict: ReviewRow = { property: 'nickname', server: 'Bob', local: 'Robert', preselect: undefined, kind: 'text', changed: true };

function request(title: string, serverName = 'Phone book'): ReviewRequest {
  const prepared = { uid: title, server: {}, rows: [conflict] } as unknown as PreparedSync;
  return { title, serverName, warnings: [], prepared, also: () => [], rename: () => undefined };
}

function review(path: string, badges: Badge[], messages: string[] = []): SyncAllItem {
  const name = path.replace(/\.md$/, '');
  return { path, name, kind: 'review', request: request(name), badges, choices: new Map(), rename: true, messages };
}

const upToDate = (path: string): SyncAllItem => ({ path, name: path.replace(/\.md$/, ''), kind: 'upToDate' });

function stubModel(items: SyncAllItem[], extra: Partial<SyncAllState> = {}) {
  const listeners = new Set<() => void>();
  const model = {
    state: { items, scanned: items.length, total: items.length, ...extra } as SyncAllState,
    subscribe: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    }),
    scan: vi.fn(async () => {}),
    setChoices: vi.fn(),
    setRename: vi.fn(),
    refresh: vi.fn(async () => {}),
    apply: vi.fn(async () => {}),
    readyPaths: vi.fn(() => ['Ann.md', 'Bob.md']),
    applyAllReady: vi.fn(async () => ({ applied: 2, changed: 1, failed: 0 })),
    /** Replaces the state and tells the panel, as the real model does. */
    set(state: Partial<SyncAllState>) {
      model.state = { ...model.state, ...state };
      for (const listener of listeners) listener();
    },
  };
  return model;
}

let container: HTMLDivElement;
let root: Root;

function render(model: ReturnType<typeof stubModel>, serverOnly = vi.fn(async () => () => [])) {
  act(() =>
    root.render(
      React.createElement(SyncAllPanel, { model: model as never, linkName: (l: string) => l, serverOnly }),
    ),
  );
  return serverOnly;
}

const text = () => container.textContent ?? '';
const button = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement | undefined;
const buttonStarting = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.startsWith(label)) as HTMLButtonElement | undefined;
const rows = () => [...container.querySelectorAll<HTMLElement>('.friendly-sync-all-row')];
const row = (name: string) => rows().find((r) => r.textContent?.includes(name))!;
const title = () => container.querySelector('.friendly-sync-all-title')?.textContent;
const click = (element: Element) => act(() => (element as HTMLElement).click());

beforeEach(() => {
  notices.length = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the list', () => {
  it('shows each review row with its badges, done rows ticked, and the blocked group with reasons', () => {
    render(
      stubModel([
        review('Ann.md', ['conflict', 'server']),
        review('Bob.md', ['obsidian']),
        review('Cas.md', ['newCard']),
        { path: 'Dirk.md', name: 'Dirk', kind: 'done', messages: [] },
        { path: 'Eva.md', name: 'Eva', kind: 'blocked', reason: 'needs Convert' },
      ]),
    );
    expect(row('Ann').textContent).toContain('Conflict');
    expect(row('Ann').textContent).toContain('From Phone book');
    expect(row('Bob').textContent).toContain('From Obsidian');
    expect(row('Cas').textContent).toContain('New card');
    expect(row('Dirk').classList.contains('is-done')).toBe(true);
    expect(row('Dirk').textContent).toContain('✓');
    const blocked = container.querySelector('.friendly-sync-all-blocked')!;
    expect(blocked.textContent).toContain('Cannot be synced');
    expect(blocked.textContent).toContain('Eva');
    expect(blocked.textContent).toContain('needs Convert');
    // Up-to-date and blocked contacts are not rows of the list.
    expect(rows().map((r) => r.textContent?.includes('Eva'))).not.toContain(true);
  });

  it('counts the contacts that are up to date', () => {
    render(stubModel([upToDate('A.md'), upToDate('B.md'), review('Ann.md', ['server'])]));
    expect(text()).toContain('2 up to date');
    expect(rows()).toHaveLength(1);
  });

  it('shows the progress while scanning', () => {
    render(stubModel([upToDate('A.md')], { scanned: 3, total: 10, busy: 'scan' }));
    expect(text()).toContain('Scanning 3 of 10…');
  });

  it('shows "<done> of <listed> done"', () => {
    render(stubModel([review('Ann.md', ['server']), { path: 'Dirk.md', name: 'Dirk', kind: 'done', messages: [] }, upToDate('A.md')]));
    expect(text()).toContain('1 of 2 done');
  });
});

describe('selection', () => {
  const items = () => [review('Ann.md', ['server']), review('Bob.md', ['obsidian']), review('Cas.md', ['server'])];

  it('selects the first review item when nothing is selected, and loads its server-only lookup', () => {
    const serverOnly = render(stubModel(items()));
    expect(title()).toBe('Ann');
    expect(serverOnly).toHaveBeenCalledWith('Ann.md');
  });

  it('selects a row when it is clicked', () => {
    render(stubModel(items()));
    click(row('Bob'));
    expect(title()).toBe('Bob');
    expect(row('Bob').getAttribute('aria-selected')).toBe('true');
    expect(row('Ann').getAttribute('aria-selected')).toBe('false');
  });

  it('Next and Previous move through the review items', () => {
    render(stubModel([review('Ann.md', ['server']), { path: 'Bas.md', name: 'Bas', kind: 'done', messages: [] }, review('Cas.md', ['server'])]));
    expect(button('Previous')!.disabled).toBe(true);
    click(button('Next')!);
    // The done row in between is skipped.
    expect(title()).toBe('Cas');
    expect(button('Next')!.disabled).toBe(true);
    click(button('Previous')!);
    expect(title()).toBe('Ann');
  });

  it('shows the messages of the selected item above its review', () => {
    render(stubModel([review('Ann.md', ['server'], ['Changed since the scan; check it again.'])]));
    expect(container.querySelector('.friendly-sync-all-messages')?.textContent).toContain('Changed since the scan');
  });
});

describe('the review', () => {
  it('a pick calls setChoices with the item path', () => {
    const model = stubModel([review('Ann.md', ['conflict'])]);
    render(model);
    const pick = [...container.querySelectorAll('[role="radiogroup"][aria-label="nickname result"] button')].find(
      (b) => b.textContent === 'Obsidian',
    )!;
    click(pick);
    expect(model.setChoices).toHaveBeenCalledWith('Ann.md', new Map<string, Choice>([['nickname', 'local']]));
  });

  it('shows the choices the model holds', () => {
    const item = review('Ann.md', ['conflict']);
    if (item.kind === 'review') item.choices = new Map<string, Choice>([['nickname', 'server']]);
    render(stubModel([item]));
    const picked = container.querySelector('[role="radiogroup"][aria-label="nickname result"] [aria-checked="true"]');
    expect(picked?.textContent).toBe('Phone book');
  });

  it('Apply applies the item and then selects the next review item', async () => {
    const model = stubModel([review('Ann.md', ['server']), review('Bob.md', ['server'])]);
    if (model.state.items[0].kind === 'review') model.state.items[0].choices = new Map<string, Choice>([['nickname', 'server']]);
    model.apply.mockImplementation(async () => {
      model.set({ items: [{ path: 'Ann.md', name: 'Ann', kind: 'done', messages: [] }, model.state.items[1]] });
    });
    render(model);
    await act(async () => button('Apply')!.click());
    expect(model.apply).toHaveBeenCalledWith('Ann.md');
    expect(title()).toBe('Bob');
  });

  it('disables the picks while the model is busy', () => {
    render(stubModel([review('Ann.md', ['conflict'])], { busy: 'apply' }));
    const pick = container.querySelector<HTMLButtonElement>('[role="radiogroup"][aria-label="nickname result"] button')!;
    expect(pick.disabled).toBe(true);
  });
});

describe('the buttons', () => {
  it('Apply all shows the ready count, applies them and reports once', async () => {
    const model = stubModel([review('Ann.md', ['server']), review('Bob.md', ['server'])]);
    render(model);
    const applyAll = button('Apply all that are ready (2)')!;
    expect(applyAll.disabled).toBe(false);
    await act(async () => applyAll.click());
    expect(model.applyAllReady).toHaveBeenCalledTimes(1);
    expect(notices).toEqual(['Applied 2, 1 changed since the scan']);
  });

  it('Apply all is disabled with nothing ready, or while busy', () => {
    const model = stubModel([review('Ann.md', ['conflict'])]);
    model.readyPaths.mockReturnValue([]);
    render(model);
    expect(button('Apply all that are ready (0)')!.disabled).toBe(true);
    model.readyPaths.mockReturnValue(['Ann.md']);
    act(() => model.set({ busy: 'scan' }));
    expect(buttonStarting('Apply all that are ready')!.disabled).toBe(true);
  });

  it('Scan again scans, and is disabled while busy', () => {
    const model = stubModel([review('Ann.md', ['server'])]);
    render(model);
    click(button('Scan again')!);
    expect(model.scan).toHaveBeenCalledTimes(1);
    act(() => model.set({ busy: 'scan' }));
    expect(button('Scan again')!.disabled).toBe(true);
  });
});
