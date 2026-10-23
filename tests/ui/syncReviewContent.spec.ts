// @vitest-environment jsdom
import * as React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Choice, ReviewRow } from 'src/sync/review';
import type { PreparedSync } from 'src/sync/syncContact';
import { SyncReviewContent, SyncReviewInput } from 'src/ui/modals/syncReviewModal';

vi.mock('obsidian', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Modal: class {},
  Notice: class {},
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const conflict: ReviewRow = { property: 'nickname', server: 'Bob', local: 'Robert', preselect: undefined, kind: 'text', changed: true };
const preselected: ReviewRow = { property: 'title', server: 'Dr', local: 'Prof', preselect: 'local', kind: 'text', changed: true };

function makeInput(overrides: Partial<SyncReviewInput> = {}): SyncReviewInput {
  const prepared = { uid: 'u1', server: {}, rows: [conflict, preselected] } as unknown as PreparedSync;
  return {
    title: 'Sync',
    serverName: 'Radicale',
    warnings: [],
    prepared,
    also: () => [],
    rename: () => undefined,
    serverOnly: () => [],
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

type Props = Partial<React.ComponentProps<typeof SyncReviewContent>>;
function render(props: Props = {}, input: SyncReviewInput = makeInput()) {
  act(() =>
    root.render(
      React.createElement(SyncReviewContent, {
        input,
        linkName: (l: string) => l,
        onApply: () => {},
        onImported: () => {},
        ...props,
      }),
    ),
  );
}

const buttons = () => [...container.querySelectorAll('button')];
const button = (text: string) => buttons().find((b) => b.textContent === text) as HTMLButtonElement | undefined;
const pick = (property: string, label: string) =>
  [...container.querySelectorAll(`[role="radiogroup"][aria-label="${property} result"] button`)].find(
    (b) => b.textContent === label,
  ) as HTMLButtonElement;
const edit = (property: string) =>
  container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="Custom value for ${property}"]`)!;
const click = (element: Element) => act(() => (element as HTMLElement).click());

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('uncontrolled', () => {
  it('selects on click', () => {
    render();
    expect(pick('nickname', 'Obsidian').getAttribute('aria-checked')).toBe('false');
    click(pick('nickname', 'Obsidian'));
    expect(pick('nickname', 'Obsidian').getAttribute('aria-checked')).toBe('true');
    expect(button('Apply')!.disabled).toBe(false);
  });

  it('has a Cancel button only with onCancel', () => {
    render();
    expect(button('Cancel')).toBeUndefined();
    const onCancel = vi.fn();
    render({ onCancel });
    click(button('Cancel')!);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders extraButtons', () => {
    render({ extraButtons: React.createElement('button', { className: 'extra' }, 'Skip') });
    expect(button('Skip')).toBeDefined();
    expect(container.querySelector('.friendly-review-buttons .extra')).not.toBeNull();
  });
});

describe('controlled choices', () => {
  it('calls onChoicesChange with the pick', () => {
    const onChoicesChange = vi.fn();
    render({ choices: new Map(), onChoicesChange });
    click(pick('nickname', 'Obsidian'));
    expect(onChoicesChange).toHaveBeenCalledWith(new Map<string, Choice>([['nickname', 'local']]));
  });

  it('shows the choices prop, not internal state', () => {
    render({ choices: new Map(), onChoicesChange: () => {} });
    click(pick('nickname', 'Obsidian'));
    // The parent did not take the change: nothing is selected.
    expect(pick('nickname', 'Obsidian').getAttribute('aria-checked')).toBe('false');
    render({ choices: new Map<string, Choice>([['nickname', 'server']]), onChoicesChange: () => {} });
    expect(pick('nickname', 'Radicale').getAttribute('aria-checked')).toBe('true');
    expect(pick('nickname', 'Obsidian').getAttribute('aria-checked')).toBe('false');
  });

  it('Apply gets the choices prop', () => {
    const onApply = vi.fn();
    const choices = new Map<string, Choice>([['nickname', 'server']]);
    render({ choices, onChoicesChange: () => {}, onApply });
    click(button('Apply')!);
    expect(onApply).toHaveBeenCalledWith(choices, false);
  });
});

describe('rename', () => {
  const input = () => makeInput({ rename: () => ({ to: 'Robert' }) });
  const checkbox = () => container.querySelector<HTMLInputElement>('.friendly-review-rename input')!;

  it('uncontrolled: starts checked and toggles', () => {
    render({}, input());
    expect(checkbox().checked).toBe(true);
    click(checkbox());
    expect(checkbox().checked).toBe(false);
  });

  it('controlled: follows the prop and reports changes', () => {
    const onRenameChange = vi.fn();
    render({ rename: false, onRenameChange }, input());
    expect(checkbox().checked).toBe(false);
    click(checkbox());
    expect(onRenameChange).toHaveBeenCalledWith(true);
    expect(checkbox().checked).toBe(false);
  });
});

describe('disabled', () => {
  const importing = [{ name: 'Jan', import: async () => {} }];
  const full = () =>
    makeInput({
      rename: () => ({ to: 'Robert' }),
      serverOnly: (row) => (row.property === 'nickname' ? importing : []),
    });

  it('absent: every control works as today', () => {
    render({ choices: new Map<string, Choice>([['nickname', 'local']]), onChoicesChange: () => {} }, full());
    for (const element of container.querySelectorAll('button, input, textarea')) {
      expect((element as HTMLButtonElement).disabled).toBe(false);
    }
  });

  it('true: every control that changes something is disabled, Show all stays enabled', () => {
    render({ disabled: true, choices: new Map<string, Choice>([['nickname', 'local']]), onChoicesChange: () => {} }, full());
    const names = [...container.querySelectorAll<HTMLButtonElement>('.friendly-review-pick button')];
    expect(names).toHaveLength(4);
    expect(button('All from Radicale')!.disabled).toBe(true);
    expect(button('All from Obsidian')!.disabled).toBe(true);
    expect(button('Import')!.disabled).toBe(true);
    expect(button('Apply')!.disabled).toBe(true);
    for (const b of names) expect(b.disabled).toBe(true);
    expect(edit('nickname').disabled).toBe(true);
    expect(edit('title').disabled).toBe(true);
    expect(container.querySelector<HTMLInputElement>('.friendly-review-rename input')!.disabled).toBe(true);
    expect(container.querySelector<HTMLInputElement>('.friendly-review-showall input')!.disabled).toBe(false);
  });

  it('true: a multi-line edit is disabled too', () => {
    const row: ReviewRow = { ...conflict, server: 'a\nb' };
    const prepared = { uid: 'u1', server: {}, rows: [row] } as unknown as PreparedSync;
    render({ disabled: true }, makeInput({ prepared }));
    expect(edit('nickname').tagName).toBe('TEXTAREA');
    expect(edit('nickname').disabled).toBe(true);
  });
});
