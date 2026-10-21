// @vitest-environment jsdom
import * as React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MAPPING } from 'src/contacts/friendly/mapping';
import { DateLabelsSettings } from 'src/ui/settings/components/dateLabelsSettings';

const notices: string[] = [];

vi.mock('obsidian', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Notice: class {
    constructor(message: string) {
      notices.push(message);
    }
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  notices.length = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function render(onAdd: (label: string, property: string) => Promise<void>) {
  act(() => {
    root.render(
      React.createElement(DateLabelsSettings, {
        app: {} as never,
        rows: DEFAULT_MAPPING,
        revision: 0,
        onRename: () => {},
        onAdd,
        onRemove: () => {},
      }),
    );
  });
}

const input = (name: string) => container.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!;

/** Types into a controlled input the way React notices. */
function type(element: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(element, text);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const enter = (element: HTMLInputElement) =>
  element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

describe('DateLabelsSettings add line', () => {
  it('ignores a second Enter while an Add runs', async () => {
    let finish: () => void = () => {};
    const onAdd = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    render(onAdd);
    type(input('Label'), 'Verkering');
    type(input('Property'), 'dating');
    // Both before React re-renders: the second must not start another Add.
    act(() => {
      enter(input('Property'));
      enter(input('Property'));
    });
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith('Verkering', 'dating');
    await act(async () => finish());

    // Once it is done, Add works again.
    act(() => enter(input('Property')));
    expect(onAdd).toHaveBeenCalledTimes(2);
  });

  it('a failing Add is a notice and an error in the console, not an unhandled rejection', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onAdd = vi.fn(async () => {
      throw new Error('disk full');
    });
    render(onAdd);
    type(input('Label'), 'Verkering');
    type(input('Property'), ' dating ');
    await act(async () => {
      enter(input('Property'));
    });
    expect(notices).toEqual(['Could not add dating: disk full']);
    expect(logged).toHaveBeenCalledWith('Friendly Contacts: could not add dating', expect.any(Error));
    // The button is usable again.
    expect(container.querySelector<HTMLButtonElement>('tbody tr:last-child button')!.disabled).toBe(false);
  });
});
