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

/** Drops the cached adapter of a removed source. */
export function forgetAdapter(sourceId: string): void {
  adapters.delete(sourceId);
}

/** Tries the address book with these settings. Returns what to tell the user when it does not work, else undefined. */
export async function connectionProblem(source: Pick<Source, 'addressBookUrl' | 'authType' | 'authKey'>): Promise<string | undefined> {
  try {
    const result = await carddavAdapter(source).checkConnectivity();
    if (result.errorMessage) {
      return `failed to enable connection! ${result.errorMessage}. Please check your connection settings.`;
    }
    if (!(result.status >= 200 && result.status < 300)) {
      return 'failed to enable connection! unknown error. Please check your connection settings.';
    }
    return undefined;
  } catch (err: any) {
    return `failed to enable connection! ${err?.message || err || 'Unknown error'}.`;
  }
}
