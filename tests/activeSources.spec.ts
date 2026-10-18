import { signal } from "@preact/signals-core";
import { Platform } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContactsPluginSettings, Source } from "src/settings/settings";

const settingsSignal = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock("src/context/sharedSettingsContext", async () => {
  const { signal } = await import("@preact/signals-core");
  const s = signal<unknown>(undefined);
  settingsSignal.current = s;
  return { settings: s, getSettings: () => s.value };
});

import { activeSources, adapterFor, defaultActiveSource, isSyncAvailable } from "src/sync/adapters";

const source = (id: string, enabled = true, extra: Partial<Source> = {}): Source => ({
  id, name: id, addressBookUrl: `http://x/${id}/`, authType: 'apikey', authKey: 'k', enabled, ...extra,
});

const put = (sources: Source[], defaultSource = sources[0]?.id ?? '') => {
  (settingsSignal.current as ReturnType<typeof signal>).value = { sources, defaultSource } as unknown as ContactsPluginSettings;
};

describe('active sources', () => {
  beforeEach(() => {
    (Platform as { isMobileApp: boolean }).isMobileApp = false;
    (settingsSignal.current as ReturnType<typeof signal>).value = undefined;
  });
  afterEach(() => {
    (Platform as { isMobileApp: boolean }).isMobileApp = false;
  });

  it('is empty before settings are loaded', () => {
    expect(activeSources()).toEqual([]);
    expect(isSyncAvailable()).toBe(false);
    expect(defaultActiveSource()).toBeUndefined();
  });

  it('lists only enabled sources', () => {
    put([source('a'), source('b', false), source('c')]);
    expect(activeSources().map((s) => s.id)).toEqual(['a', 'c']);
    expect(isSyncAvailable()).toBe(true);
  });

  it('is unavailable when no source is enabled', () => {
    put([source('a', false)]);
    expect(isSyncAvailable()).toBe(false);
  });

  it('is unavailable on mobile without touching the settings', () => {
    put([source('a')]);
    (Platform as { isMobileApp: boolean }).isMobileApp = true;
    expect(activeSources()).toEqual([]);
    expect(isSyncAvailable()).toBe(false);
    expect(defaultActiveSource()).toBeUndefined();
    expect((settingsSignal.current as ReturnType<typeof signal>).value).toMatchObject({ sources: [{ id: 'a', enabled: true }] });
  });

  it('default active source is the default source only when it is enabled', () => {
    put([source('a'), source('b')], 'b');
    expect(defaultActiveSource()?.id).toBe('b');
    put([source('a'), source('b', false)], 'b');
    expect(defaultActiveSource()).toBeUndefined();
  });

  it('caches an adapter per id, url and key', () => {
    const a = source('a');
    expect(adapterFor(a)).toBe(adapterFor({ ...a, name: 'renamed' }));
    expect(adapterFor(a)).not.toBe(adapterFor({ ...a, authKey: 'other' }));
    expect(adapterFor(a)).not.toBe(adapterFor({ ...a, addressBookUrl: 'http://x/elsewhere/' }));
    expect(adapterFor(a)).not.toBe(adapterFor(source('b')));
  });
});
