import { Platform } from "obsidian";
import { settings } from "src/context/sharedSettingsContext";
import { Source } from "src/settings/settings";
import { AdapterInterface } from "src/sync/adapters/adapterInterface";
import { carddavAdapter } from "src/sync/adapters/carddavGeneric";
import { defaultSourceOf } from "src/sync/sources";

/** Enabled address books. None on mobile, where sources are unavailable (the settings stay as they are). */
export function activeSources(): Source[] {
  if (Platform.isMobileApp) return [];
  return settings.value?.sources.filter((source) => source.enabled) ?? [];
}

export function isSyncAvailable(): boolean {
  return activeSources().length > 0;
}

/** The default source, when it is active. Callers that are not source-aware yet use this one. */
export function defaultActiveSource(): Source | undefined {
  const current = settings.value;
  if (!current) return undefined;
  const source = defaultSourceOf(current);
  return source && activeSources().some((s) => s.id === source.id) ? source : undefined;
}

/** One entry per source id, so an edited source replaces its old adapter (and the old credentials) instead of adding one. */
const adapters = new Map<string, { key: string; adapter: AdapterInterface }>();

/** The adapter for one source; reused while its url and credentials are unchanged. */
export function adapterFor(source: Source): AdapterInterface {
  const key = JSON.stringify([source.addressBookUrl, source.authType, source.authKey]);
  const cached = adapters.get(source.id);
  if (cached?.key === key) return cached.adapter;
  const adapter = carddavAdapter(source);
  adapters.set(source.id, { key, adapter });
  return adapter;
}
