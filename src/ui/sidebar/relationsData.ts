/**
 * What the sidebar's relationship sections share, so that hundreds of contact cards cost one subscription and one
 * server listing: a version that changes with the contact notes, the notes by card UID, and the server listing.
 */

import { App, TAbstractFile, TFile } from "obsidian";
import { contactNotes, RemoteContact, remoteContactsWithFailures } from "src/contacts/obsidianNotes";
import { getSettings } from "src/context/sharedSettingsContext";
import { sharedListing } from "src/util/sharedListing";
import { VersionStore, versionStore } from "src/util/versionStore";
import { cleanUid } from "src/util/vcard";

/** Changes within this time become one re-render of the sections (bulk commands touch many notes). */
const COALESCE_MS = 100;
/** A server listing that failed is not asked for again, by any card, for this long. */
const FAILED_LISTING_MS = 60_000;

const inContactsFolder = (path: string) => path.startsWith(getSettings().contactsFolder);

let store: { app: App; versions: VersionStore } | undefined;

/**
 * Goes up when a contact note's metadata changes (its own relationships, or the name of a linked contact) and when
 * a note is created, renamed or deleted in the contacts folder (a link may resolve or break).
 */
export function contactsVersion(app: App): VersionStore {
  if (store?.app !== app) {
    store = {
      app,
      versions: versionStore((bump) => {
        const changedRef = app.metadataCache.on("changed", (file: TFile) => {
          if (inContactsFolder(file.path)) bump();
        });
        const onFile = (file: TAbstractFile, oldPath?: string) => {
          if (inContactsFolder(file.path) || (oldPath !== undefined && inContactsFolder(oldPath))) bump();
        };
        const vaultRefs = [
          app.vault.on("create", onFile),
          app.vault.on("rename", onFile),
          app.vault.on("delete", onFile),
        ];
        return () => {
          app.metadataCache.offref(changedRef);
          for (const ref of vaultRefs) app.vault.offref(ref);
        };
      }, COALESCE_MS),
    };
  }
  return store.versions;
}

let notePaths: { app: App; version: number; byUid: Map<string, string> } | undefined;

/** The contact note of each UID, read once per version of the contact notes. */
export function notePathsByUid(app: App, version: number): Map<string, string> {
  if (notePaths?.app !== app || notePaths.version !== version) {
    const byUid = new Map<string, string>();
    for (const { file, uid } of contactNotes(app)) if (uid !== undefined) byUid.set(cleanUid(uid), file.path);
    notePaths = { app, version, byUid };
  }
  return notePaths.byUid;
}

/** The contacts on the servers, for every section that asks (see `sharedListing`). */
export const listRemoteForSidebar: () => Promise<RemoteContact[]> = sharedListing(
  remoteContactsWithFailures,
  FAILED_LISTING_MS,
  (error) => console.error("Friendly Contacts: could not list the server contacts", error),
);
