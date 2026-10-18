import { effect } from "@preact/signals-core";
import { App } from "obsidian";
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
import type { ContactsPluginSettings, Source } from 'src/settings/settings.d';
import { afterEach,describe, expect, it, vi } from 'vitest';

const mockSettings: ContactsPluginSettings = {
  contactsFolder: 'Contacts',
  defaultHashtag: '',
  processors: {
    someRandomProcessor: true,
  },
  groupInsights: true,
  sources: [],
  defaultSource: '',
  createFieldsKeys:['N.FN'],
  friendly: { mapping: [], mirrorRelations: false } as ContactsPluginSettings['friendly'],
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

  it('initSettings migrates CardDAV to a source', async () => {
    const { sources: _sources, defaultSource: _defaultSource, ...old } = mockSettings;
    const legacy = {
      ...old,
      syncEnabled: true,
      syncSelected: 'CardDAV',
      CardDAV: { addressBookUrl: 'https://pim.example/frank/contacts/', authType: 'basic', authKey: 'k', syncInterval: 900 },
    };
    await initSettings(async () => legacy, saveData);
    const saved = saveData.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(saved.sources).toEqual([expect.objectContaining({
      name: 'contacts', addressBookUrl: 'https://pim.example/frank/contacts/', authType: 'basic', authKey: 'k', enabled: true,
    })]);
    expect(saved.defaultSource).toBe((saved.sources as Source[])[0].id);
    expect(saved).not.toHaveProperty('CardDAV');
    expect(saved).not.toHaveProperty('syncEnabled');
    expect(saved).not.toHaveProperty('syncSelected');
  });

  it('gives stored settings without a friendly key the default mapping', async () => {
    const { friendly: _omitted, ...legacy } = mockSettings;
    await initSettings(async () => legacy, saveData);
    expect(getSettings().friendly).toEqual(DEFAULT_SETTINGS.friendly);
  });

  it('keeps a stored mapping and drops a stored mirrorRelations (it is per device now)', async () => {
    await initSettings(async () => mockSettings, saveData);
    expect(getSettings().friendly).toEqual({ mapping: [] });
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

  it('two overlapping saves cannot lose one another', async () => {
    const started: ContactsPluginSettings[] = [];
    const finish: Array<() => void> = [];
    let slow = false;
    const diskSave = vi.fn((data: ContactsPluginSettings) => {
      if (!slow) return Promise.resolve();
      started.push(data);
      return new Promise<void>((resolve) => finish.push(resolve));
    });
    await initSettings(loadData, diskSave);
    slow = true;
    // Two patches, each made from the settings as they are when it is made (like saveSourcePatch).
    const first = setSettings({ ...getSettings(), contactsFolder: 'A' });
    const second = setSettings({ ...getSettings(), defaultHashtag: '#b' });
    expect(getSettings()).toMatchObject({ contactsFolder: 'A', defaultHashtag: '#b' });
    // Writes go one after the other, in call order.
    await vi.waitFor(() => expect(started).toHaveLength(1));
    finish[0]();
    await vi.waitFor(() => expect(started).toHaveLength(2));
    finish[1]();
    await Promise.all([first, second]);
    expect(started[1]).toMatchObject({ contactsFolder: 'A', defaultHashtag: '#b' });
  });

  it('a failed save rejects its caller but later saves still go through', async () => {
    const failing = vi.fn().mockResolvedValue(undefined);
    await initSettings(loadData, failing);
    failing.mockClear();
    failing.mockRejectedValueOnce(new Error('disk full'));
    await expect(setSettings({ ...getSettings(), contactsFolder: 'X' })).rejects.toThrow('disk full');
    await setSettings({ ...getSettings(), contactsFolder: 'Y' });
    expect(failing).toHaveBeenCalledTimes(2);
    expect(failing.mock.calls[1][0]).toMatchObject({ contactsFolder: 'Y' });
  });

  it('initSettings reports the migrated book on the first load only', async () => {
    const { sources: _sources, defaultSource: _defaultSource, ...old } = mockSettings;
    const legacy = {
      ...old,
      syncEnabled: true,
      syncSelected: 'CardDAV',
      CardDAV: { addressBookUrl: 'https://pim.example/frank/contacts/', authType: 'basic', authKey: 'k', syncInterval: 900 },
    };
    const first = await initSettings(async () => legacy, saveData);
    const saved = saveData.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(first).toEqual({ migratedFrom: 'carddav' });
    expect((saved.sources as Source[])[0].id).toBe('carddav');
    // The second start loads what the first one saved.
    const second = await initSettings(async () => saved, saveData);
    expect(second.migratedFrom).toBeUndefined();
    expect(getSettings().sources).toEqual(saved.sources);
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
