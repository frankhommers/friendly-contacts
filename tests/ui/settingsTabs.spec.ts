// @vitest-environment jsdom
import * as React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A section that only shows its name; React is imported inside the factory because vi.mock is hoisted.
const section = vi.hoisted(() => async (exportName: string, name: string) => {
  const { createElement } = await import('react');
  return { [exportName]: () => createElement('div', { className: 'section' }, name) };
});
vi.mock('src/ui/settings/components/masterSettings', () => section('MasterSetting', 'Master'));
vi.mock('src/ui/settings/components/layoutSettings', () => section('LayoutSettingsSection', 'Layout'));
vi.mock('src/ui/settings/components/cardFieldSettings', () => section('CardFieldSettings', 'Card fields'));
vi.mock('src/ui/settings/components/insightsSettings', () => section('InsightSettings', 'Background checks'));
vi.mock('src/ui/settings/components/synchronizationSettings', () => section('SynchronizationSettings', 'Synchronization'));
vi.mock('src/ui/settings/components/propertyNamesSettings', () => section('PropertyNamesSettings', 'Property names'));
vi.mock('src/ui/modals/layoutChangeModal', () => ({ offerLayoutChange: () => {} }));

import { SettingsTabs } from 'src/ui/settings/components/settingsTabs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const sections = () => [...container.querySelectorAll('.section')].map((el) => el.textContent);
const tab = (name: string) => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) => b.textContent === name)!;
const show = () => act(() => root.render(React.createElement(SettingsTabs, { app: {} as never })));

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the settings tabs', () => {
  it('has General, Sync and Properties, and opens on General', () => {
    show();
    expect([...container.querySelectorAll('[role="tab"]')].map((b) => b.textContent)).toEqual(['General', 'Sync', 'Properties']);
    expect(tab('General').getAttribute('aria-selected')).toBe('true');
    expect(sections()).toEqual(['Master', 'Layout', 'Card fields', 'Background checks']);
  });

  it('shows one tab at a time', () => {
    show();
    act(() => tab('Sync').click());
    expect(sections()).toEqual(['Synchronization']);
    act(() => tab('Properties').click());
    expect(sections()).toEqual(['Property names']);
    expect(tab('Properties').classList.contains('is-active')).toBe(true);
    expect(tab('General').getAttribute('aria-selected')).toBe('false');
  });

  it('opens on the tab shown last', () => {
    show();
    act(() => tab('Properties').click());
    act(() => root.unmount());
    root = createRoot(container);
    show();
    expect(sections()).toEqual(['Property names']);
  });
});
