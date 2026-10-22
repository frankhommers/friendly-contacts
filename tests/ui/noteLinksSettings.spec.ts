// @vitest-environment jsdom
import * as React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getSettings, initSettings, reloadSettings } from 'src/context/sharedSettingsContext';
import { NoteLinksSettings } from 'src/ui/settings/components/noteLinksSettings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const app = { vault: { getName: () => 'Mac Notes' } } as never;

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await initSettings(async () => ({}), async () => {});
  act(() => root.render(React.createElement(NoteLinksSettings, { app })));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const toggle = () => container.querySelector<HTMLElement>('[role="switch"][aria-label="Links to Obsidian notes on cards"]')!;
const field = () => container.querySelector<HTMLInputElement>('input[aria-label="Vault name on your phone"]');

/** Types into a controlled input the way React notices. */
function type(element: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(element, text);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const blur = (element: HTMLInputElement) =>
  act(() => {
    element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });

describe('NoteLinksSettings', () => {
  it('is off by default: the switch is off and there is no vault field', () => {
    expect(toggle().getAttribute('aria-checked')).toBe('false');
    expect(field()).toBeNull();
    expect(container.textContent).toContain('Links to Obsidian notes on cards');
  });

  it('turning it on stores this vault name and shows the field', async () => {
    await act(async () => toggle().click());
    expect(getSettings().noteLinks).toEqual({ enabled: true, vaultName: 'Mac Notes', formerVaultNames: [] });
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    expect(field()!.value).toBe('Mac Notes');
  });

  it('a new vault name keeps the old one as a former name; clearing it goes back to this vault', async () => {
    await act(async () => toggle().click());
    type(field()!, 'Phone Notes');
    await act(async () => blur(field()!));
    expect(getSettings().noteLinks).toEqual({ enabled: true, vaultName: 'Phone Notes', formerVaultNames: ['Mac Notes'] });

    type(field()!, '');
    await act(async () => blur(field()!));
    expect(getSettings().noteLinks).toEqual({ enabled: true, vaultName: 'Mac Notes', formerVaultNames: ['Phone Notes'] });
    expect(field()!.value).toBe('Mac Notes');
  });

  it('turning it off keeps the vault name and hides the field', async () => {
    await act(async () => toggle().click());
    await act(async () => toggle().click());
    expect(getSettings().noteLinks).toEqual({ enabled: false, vaultName: 'Mac Notes', formerVaultNames: [] });
    expect(toggle().getAttribute('aria-checked')).toBe('false');
    expect(field()).toBeNull();
  });

  it('shows settings reloaded from disk, and the switch turns off what is stored', async () => {
    await act(async () => {
      await reloadSettings(async () => ({ noteLinks: { enabled: true, vaultName: 'Phone', formerVaultNames: [] } }));
    });
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    expect(field()!.value).toBe('Phone');

    await act(async () => toggle().click());
    expect(getSettings().noteLinks).toEqual({ enabled: false, vaultName: 'Phone', formerVaultNames: [] });
    expect(toggle().getAttribute('aria-checked')).toBe('false');
  });
});
