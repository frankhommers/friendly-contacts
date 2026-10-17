import { effect } from "@preact/signals-core";
import { App, Platform } from "obsidian";
import { clearApp,getApp, setApp } from 'src/context/sharedAppContext'
import {
  clearSettings,
  getSettings, initSettings,
  setSettings,
  settings, updateSetting,
} from 'src/context/sharedSettingsContext';


vi.mock("src/insights/insightService", () => ({
  insightService: {
    settings: vi.fn(() => [
      { settingPropertyName: "someRandomProcessor", settingDefaultValue: true },
      { settingPropertyName: "anotherProcessor", settingDefaultValue: false },
    ]),
  },
}));

import { DEFAULT_SETTINGS, LEGACY_CREATE_FIELDS_KEYS } from "src/settings/setting";
import type { ContactsPluginSettings } from 'src/settings/settings.d';
import { afterEach,describe, expect, it, vi } from 'vitest';

const mockSettings: ContactsPluginSettings = {
  contactsFolder: 'Contacts',
  defaultHashtag: '',
  processors: {
    someRandomProcessor: true,
  },
  syncEnabled: false,
  groupInsights: true,
  syncSelected: 'None',
  CardDAV: {
    addressBookUrl: '',
    syncInterval: 900,
    authKey: '',
    authType: 'apikey'
  },
  createFieldsKeys:['N.FN'],
  friendly: { mapping: [], mirrorRelations: false },
};

const testDefaultSettings = {
  ...DEFAULT_SETTINGS,
  ...{processors: {
      "anotherProcessor": false,
      "someRandomProcessor": true,
    }}
};


export const loadData = vi.fn(async () => mockSettings);
// Async mock that records calls and resolves
export const saveData = vi.fn(async (data: ContactsPluginSettings) => {
  // You can inspect `data` in your tests
  return Promise.resolve();
});
describe('sharedAppContext', () => {
  afterEach(() => clearApp());

  it('stores and retrieves the app instance', () => {
    const mockApp = { vault: { name: 'test' }, workspace: { activeLeaf: true } } as unknown as App;
    setApp(mockApp);
    const retrieved = getApp();
    expect(retrieved).toBe(mockApp);
  });

  it('throws if app is not set', () => {
    expect(() => getApp()).toThrow('App context has not been set.');
  });
});

describe('sharedSettingsContext', () => {
  afterEach(() => {
    clearSettings();
    vi.clearAllMocks();
  });

  it('should be initialized and have default settings', async () => {
    await initSettings(async () => {}, saveData)
    const retrieved = getSettings();
    expect(retrieved).to.deep.equal(testDefaultSettings);
    expect(saveData).toHaveBeenCalledTimes(1);
    expect(saveData).toHaveBeenCalledWith(expect.objectContaining(testDefaultSettings));
  });

  it('gives stored settings without a friendly key the default mapping', async () => {
    const { friendly: _omitted, ...legacy } = mockSettings;
    await initSettings(async () => legacy, saveData);
    expect(getSettings().friendly).toEqual(DEFAULT_SETTINGS.friendly);
    expect(getSettings().friendly.mirrorRelations).toBe(true);
  });

  it('keeps a stored friendly setting', async () => {
    await initSettings(async () => mockSettings, saveData);
    expect(getSettings().friendly).toEqual({ mapping: [], mirrorRelations: false });
  });

  it('turns mirroring off on first load on mobile', async () => {
    (Platform as { isMobileApp: boolean }).isMobileApp = true;
    try {
      await initSettings(async () => {}, saveData);
      expect(getSettings().friendly.mirrorRelations).toBe(false);
      expect(getSettings().friendly.mapping).toEqual(DEFAULT_SETTINGS.friendly.mapping);
    } finally {
      (Platform as { isMobileApp: boolean }).isMobileApp = false;
    }
  });

  it('replaces the old default contact fields with the friendly ones', async () => {
    await initSettings(async () => ({ ...mockSettings, createFieldsKeys: [...LEGACY_CREATE_FIELDS_KEYS] }), saveData);
    expect(getSettings().createFieldsKeys).toEqual(DEFAULT_SETTINGS.createFieldsKeys);
    expect(DEFAULT_SETTINGS.createFieldsKeys).toEqual([
      'firstname', 'lastname', 'mobile', 'phone', 'work-phone', 'email', 'work-email', 'birthday',
      'street', 'city', 'postcode', 'country', 'website', 'company', 'title', 'categories',
    ]);
  });

  it('keeps a customised list of contact fields', async () => {
    await initSettings(async () => mockSettings, saveData);
    expect(getSettings().createFieldsKeys).toEqual(['N.FN']);
  });

  it('setSettings should overwrite the complete settings object', async () => {
    await initSettings(loadData, saveData)
    await setSettings(mockSettings);

    const firstSaveArgs = saveData.mock.calls[0];
    const firstSaveData = firstSaveArgs[0];
    expect(firstSaveData.processors.someRandomProcessor).toBe(true);
    expect(firstSaveData.processors.anotherProcessor).toBe(false);
    const retrieved = getSettings();
    expect(saveData).toHaveBeenCalledTimes(2);
    expect(retrieved).to.deep.equal(mockSettings);
  });

  it('throws if getSettings called while not initialized', () => {
    expect(() => getSettings()).toThrow('Plugin context has not been set.');
  });

  it('throws if updateSetting called while not initialized', async () => {
    await expect(async () => await updateSetting('contactsFolder', 'empty')).rejects.toThrow('Plugin context has not been set.');
  });

  it('throws if updateSetting called with a field that does not exist in the settings object', async () => {
    await initSettings(loadData, saveData)
    await expect(async () => await updateSetting('contactsFolder.not.exist', 'empty')).rejects.toThrow('Invalid settings path: contactsFolder.not.exist');
  });

  it('calls listeners when settings are updated',  async () => {
    const listener = vi.fn();
    const unsubscribe = effect(() => {
      if (settings.value !== undefined) {
        listener(settings.value);
      }
    });
    await initSettings(loadData, saveData)
    await setSettings(mockSettings);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledWith(mockSettings);
    unsubscribe();
  });

  it('removes listener when unsubscribe is called', async () => {
    await initSettings(async () => {}, saveData);
    const listener = vi.fn();
    const unsubscribe = effect(() => {
      if (settings.value !== undefined) {
        listener(settings.value);
      }
    });

    unsubscribe();
    await setSettings(mockSettings);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(testDefaultSettings);
    const retrieved = getSettings();
    expect(retrieved).to.deep.equal(mockSettings);
  });

  it('clears listeners and settings', async () => {
    await initSettings(async () => {}, saveData);
    const listener = vi.fn();
    const unsubscribe = effect(() => {
        listener(settings.value);
    });

    await setSettings(mockSettings);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledWith(mockSettings);
    clearSettings();
    expect(() => getSettings()).toThrow();
    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener).toHaveBeenCalledWith(undefined);
    unsubscribe();
  });
});
