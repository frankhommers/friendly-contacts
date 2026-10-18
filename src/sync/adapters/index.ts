import { settings } from "src/context/sharedSettingsContext";
import { defaultSourceOf } from "src/sync/sources";
import { carddavGenericAdapter } from "src/sync/adapters/carddavGeneric";

export const adapters = {
  None: undefined,
  CardDAV: carddavGenericAdapter()
}

export function getCurrentAdapter() {
  const setting = settings.value;
  if (!setting) return undefined;
  if (!defaultSourceOf(setting)?.enabled) return undefined;
  return adapters.CardDAV;
}
