import {computed} from "@preact/signals-core";
import {Notice} from "obsidian";
import {Contact} from "src/contacts";
import {hasVCardValues} from "src/contacts/friendlyNotes";
import {contactSyncState, noteIO, relationContextFor} from "src/contacts/obsidianNotes";
import {getApp} from "src/context/sharedAppContext";
import { getSettings, settings } from "src/context/sharedSettingsContext";
import { getCurrentAdapter } from "src/sync/adapters";
import {VCardMeta, VCardRaw} from "src/sync/adapters/adapter";
import {syncContact as syncNote, SyncOutcome} from "src/sync/syncContact";
import {AppHttpResponse} from "src/util/platformHttpClient";
import {cleanUid} from "src/util/vcard";

export const enabled = computed(() => settings.value?.syncEnabled ?? false);

function hasUidMatch(remoteContact:VCardMeta, currentContacts: Contact[]) {
  const uid = remoteContact.uid;
  if(uid === undefined) {
    return false;
  }
  return currentContacts.some(contact =>  cleanUid(contact.data['UID']) === cleanUid(uid));
}

function hasFnMatch(remoteContact: VCardMeta, currentContacts: Contact[]) {
  const fn = remoteContact.fn;
  if(fn === undefined) {
    return false;
  }
  return currentContacts.some(contact => contact.data['FN'] === fn);
}

export async function getUnknownFromRemote(currentContacts: Contact[]): Promise<VCardMeta[]> {
  const fullContactList = await getList();
  if (fullContactList && "errorMessage" in fullContactList) {
    new Notice(fullContactList.errorMessage);
    return [];
  }

  if (!fullContactList) {
    return [];
  }

  return fullContactList.filter((remoteContact) => {
    return !hasUidMatch(remoteContact, currentContacts) && !hasFnMatch(remoteContact, currentContacts);
  });
}

export async function getRawVcardFromRemote(href: string) {
  const adapter = getCurrentAdapter();
  if(adapter) {
    return adapter.pull(href);
  }
  return undefined;
}

/** Deletes the contact's card on the server and forgets its sync state; true when deleted. */
export async function deleteOnRemote(contact: Contact): Promise<boolean> {
  const adapter = getCurrentAdapter();
  if (!adapter) {
    return false;
  }
  const uid = cleanUid(contact.data['UID']);
  if (!uid) {
    new Notice(`${contact.file.basename} has no UID; there is no card on the server to delete.`);
    return false;
  }
  const meta = await getMetaByUID(uid);
  if (!meta) {
    new Notice(`${contact.file.basename} was not found on the server.`);
    return false;
  }
  if (cleanUid(meta.uid) !== uid) {
    // Never delete a card that is not exactly this contact's.
    new Notice(`Not deleting: the server card found for ${contact.file.basename} has another UID (${meta.uid ?? 'none'}).`);
    return false;
  }
  const res = await adapter.delete(meta.href);
  if (res.errorMessage || res.status < 200 || res.status >= 300) {
    new Notice(res.errorMessage || res.data || `Delete failed: HTTP ${res.status}`);
    return false;
  }
  await contactSyncState().remove(uid);
  return true;
}

const OUTCOME_TEXT: Record<Exclude<SyncOutcome, 'failed'>, string> = {
  unchanged: 'already in sync',
  pulled: 'updated from the server',
  pushed: 'sent to the server',
  both: 'updated from and sent to the server',
  created: 'created on the server',
};

/** One Sync of a contact note with its card on the server (see src/sync/syncContact.ts). */
export async function syncContact(contact: Contact): Promise<SyncOutcome | undefined> {
  const adapter = getCurrentAdapter();
  if (!adapter) {
    new Notice('Sync is not set up.');
    return undefined;
  }
  const app = getApp();
  const rows = getSettings().friendly.mapping;
  const note = noteIO(app, contact.file);
  if (hasVCardValues(await note.readFrontmatter())) {
    // Sync reads only friendly properties: a UID kept in `UID` is not seen, and syncing would create a second card.
    new Notice(`${contact.file.basename} still has vCard properties (FN, UID, TEL[CELL], ...). Run "Convert contacts to friendly properties" first, then sync.`);
    return undefined;
  }

  const ctx = await relationContextFor(app, contact.file.path);
  const outcome = await syncNote(note, {
    adapter,
    state: contactSyncState(app),
    rows,
    ctx,
    notify: (message) => new Notice(message),
    now: () => new Date(),
  });
  await ctx.settle();
  if (outcome !== 'failed') {
    new Notice(`${contact.file.basename}: ${OUTCOME_TEXT[outcome]}.`);
  }
  return outcome;
}

export async function pullFromRemote(href: string): Promise<VCardRaw | undefined> {
  const remoteRaw = await getRawVcardFromRemote(href);

  if (remoteRaw && "errorMessage" in remoteRaw) {
    new Notice(remoteRaw.errorMessage);
    return;
  }
  return remoteRaw;
}


async function getList() {
  const adapter = getCurrentAdapter()
  if (adapter) {
    return adapter.getMetaList();
  }
}

async function getMetaByUID(uid: string): Promise<VCardMeta | undefined> {
  const adapter = getCurrentAdapter();
  if(adapter) {
    const res:VCardMeta | AppHttpResponse | undefined = await adapter.getMetaByUid(uid);
    if (res && "errorMessage" in res && res.errorMessage) {
      new Notice(res.errorMessage);
      return undefined;
    }
    return res as VCardMeta | undefined;
  }
}
