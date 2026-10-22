import { signal } from "@preact/signals-core";
import { addDefaultRows, migrateMapping } from "src/contacts/friendly/mapping";
import { normalizeNoteLinks } from "src/contacts/friendly/noteLinks";
import { normalizeLayout } from "src/contacts/layout";
import { insightService } from "src/insights/insightService";
import { DEFAULT_SETTINGS, LEGACY_CREATE_FIELDS_KEYS } from "src/settings/setting";
import { ContactsPluginSettings } from "src/settings/settings.d";
import { migrateSources } from "src/sync/sources";
import { deepCloneObject } from "src/util/deepCloneObject";
import { cleanUid } from "src/util/vcard";

export const settings = signal<ContactsPluginSettings | undefined>(undefined);
let saveData: (data: any) => Promise<void>;

function isLegacyDefault(keys: unknown): boolean {
  return Array.isArray(keys)
    && keys.length === LEGACY_CREATE_FIELDS_KEYS.length
    && keys.every((key, i) => key === LEGACY_CREATE_FIELDS_KEYS[i]);
}

/** Settings as read from data.json, with defaults filled in and old shapes migrated; nothing is saved here. */
function normalizeLoaded(loaded: any): { settings: ContactsPluginSettings; migratedFrom?: string } {
  const insightsSettingDefaults = insightService.settings().reduce((acc: Record<string, string | boolean>, setting) => {
    acc[setting.settingPropertyName] = setting.settingDefaultValue;
    return acc;
  }, {} as Record<string, string>);

  const { CardDAV: _cardDAV, syncSelected: _syncSelected, syncEnabled: _syncEnabled, ...rest } = loaded;
  const { sources, defaultSource, migratedFrom } = migrateSources(loaded);
  const seen = loaded.friendly?.defaultRowsSeen;
  const { rows: mapping, seen: defaultRowsSeen } = addDefaultRows(
    migrateMapping(loaded.friendly?.mapping ?? DEFAULT_SETTINGS.friendly.mapping),
    typeof seen === "number" ? seen : 0
  );
  const settings = {
    ...DEFAULT_SETTINGS,
    ...rest,
    sources,
    defaultSource,
    processors: {
      ...insightsSettingDefaults,
      ...(loaded.processors ?? {})
    },
    createFieldsKeys: isLegacyDefault(loaded.createFieldsKeys)
      ? DEFAULT_SETTINGS.createFieldsKeys
      : (loaded.createFieldsKeys ?? DEFAULT_SETTINGS.createFieldsKeys),
    // Only the mapping lives here; "mirror relationships" is per device (src/settings/deviceSettings.ts),
    // so an old mirrorRelations value in data.json is dropped. The new default rows are added once (defaultRowsSeen).
    friendly: { mapping, defaultRowsSeen },
    layout: normalizeLayout(loaded.layout),
    meUid: typeof loaded.meUid === "string" ? cleanUid(loaded.meUid) : DEFAULT_SETTINGS.meUid,
    noteLinks: normalizeNoteLinks(loaded.noteLinks)
  };
  return { settings, migratedFrom };
}

export async function initSettings(
  loadData: () => Promise<any>,   // a callable async function
  mySaveData: (data: any) => Promise<void> // another callable async function
): Promise<{ migratedFrom?: string }> {
  saveData = mySaveData;
  const { settings: initializedSettings, migratedFrom } = normalizeLoaded(await loadData() ?? {});
  await setSettings(initializedSettings);
  return { migratedFrom };
}

/**
 * Reads data.json again after it changed on disk (Obsidian Sync or another file sync), the same way as at
 * startup, and shows the result to everyone watching the settings. Nothing is saved: a save here would change
 * the file again and could start a reload loop between devices; a migration is saved with the next change.
 */
export async function reloadSettings(loadData: () => Promise<any>): Promise<void> {
  const { settings: reloaded } = normalizeLoaded(await loadData() ?? {});
  settings.value = deepCloneObject(reloaded);
}

export async function updateSetting(path: string, value: string | boolean | string[]) {
  const updated = deepCloneObject(getSettings()); // guaranteed new reference
  const keys = path.split(".");
  let target: any = updated;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in target) || typeof target[key] !== "object" || target[key] === null) {
      throw new Error(`Invalid settings path: ${path}`);
    }
    target = target[key];
  }

  const lastKey = keys[keys.length - 1];
  if (!(lastKey in target)) {
    throw new Error(`Invalid settings path: ${path} (missing final key "${lastKey}")`);
  }

  target[lastKey] = value;
  await setSettings(updated);
}

/** Saves run one after the other, in call order, so the last call is the last write. */
let saveQueue: Promise<void> = Promise.resolve();

export async function setSettings(settingsInput: ContactsPluginSettings) {
  if (!saveData) throw new Error('Plugin context has not been set.')
  // Making sure the signal fires by assigning new object.
  const updatedSettings = deepCloneObject(settingsInput);
  // The new settings are visible before the save finishes: a patch made while a save is running starts from
  // them, instead of from the old ones and overwriting this change.
  settings.value = updatedSettings;
  const write = saveQueue.then(() => saveData(updatedSettings));
  saveQueue = write.catch(() => undefined);
  await write;
}

export function getSettings(): ContactsPluginSettings {
  const current = settings.peek(); // avoid tracking if used in non-reactive contexts
  if (!current) throw new Error('Plugin context has not been set.')
  return current;
}

export function clearSettings() {
  settings.value = undefined;
}
