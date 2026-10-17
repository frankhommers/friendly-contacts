/**
 * Settings that belong to this device, not to the vault: data.json syncs to every device (Obsidian Sync,
 * iCloud, ...), localStorage does not.
 */

import { App, Platform } from "obsidian";

type Store = Pick<Storage, "getItem" | "setItem">;

export const mirrorRelationsKey = (vaultName: string): string => `friendly-contacts:mirror-relations:${vaultName}`;

/** Stored choice, else on for desktop and off for mobile (mirroring on a phone causes sync-conflict noise). */
export function readMirrorRelations(store: Store, vaultName: string, isMobile: boolean): boolean {
  const stored = store.getItem(mirrorRelationsKey(vaultName));
  if (stored === "true") return true;
  if (stored === "false") return false;
  return !isMobile;
}

export function writeMirrorRelations(store: Store, vaultName: string, on: boolean): void {
  store.setItem(mirrorRelationsKey(vaultName), String(on));
}

/** "Mirror relationships on this device". */
export function mirrorRelationsOnThisDevice(app: App): boolean {
  return readMirrorRelations(window.localStorage, app.vault.getName(), Platform.isMobileApp);
}

export function setMirrorRelationsOnThisDevice(app: App, on: boolean): void {
  writeMirrorRelations(window.localStorage, app.vault.getName(), on);
}
