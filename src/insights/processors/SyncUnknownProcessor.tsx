import * as React from "react";
import {Contact} from "src/contacts";
import {contactNotes, importRemoteCard} from "src/contacts/obsidianNotes";
import {getApp} from "src/context/sharedAppContext";
import {getSettings} from "src/context/sharedSettingsContext";
import {InsightProcessor, InsightQueItem, PropsRenderGroup, RunType} from "src/insights/insight.d";
import {insightQueueStore} from "src/insights/insightsQueStore";
import {sync} from "src/sync";
import {activeSources, isSyncAvailable} from "src/sync/adapters";
import {uidAlreadyImported} from "src/sync/sources";
import {cleanUid} from "src/util/vcard";


/** UIDs imported so far in one "Import All" run; the metadata cache may not show those notes yet. */
const ImportUnknownVcardToVault = async (queItem: InsightQueItem, importedNow: Set<string> = new Set()) => {
  // The same card can be queued once per address book; a UID that has a note is not imported again.
  const noteUids = contactNotes(getApp()).map((note) => note.uid);
  if (uidAlreadyImported(queItem.data.uid, noteUids, importedNow)) {
    await insightQueueStore.remove(queItem);
    return;
  }
  const source = activeSources().find((candidate) => candidate.id === queItem.data.sourceId);
  if (!source) {
    // The address book was removed or disabled since the insight was queued.
    await insightQueueStore.remove(queItem);
    return;
  }
  const rawCard = await sync.pullFromRemote(source, queItem.data.href);
  if (rawCard) {
    // #90 for now made the same as in the rootView skipping the record without notifying the user.
    const outcome = await importRemoteCard(getApp(), rawCard, queItem.data, source);
    if (outcome === "unnamed") console.warn("Skipping contact without name", rawCard.raw);
    // A card that was skipped because its note exists stays in the list.
    if (outcome === "imported") importedNow.add(cleanUid(queItem.data.uid ?? rawCard.uid));
    if (outcome !== "skipped") await insightQueueStore.remove(queItem);
  }
}

const renderGroup = ({queItems}: PropsRenderGroup): JSX.Element | null => {
  const addVcardsToVault = () => {
    return async (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const importedNow = new Set<string>();
      for (const queItem of queItems) {
        await ImportUnknownVcardToVault(queItem, importedNow);
      }
    }
  }

  return (
    <div className="action-card">
      <div className="action-card-content">
        <p><strong>Contacts available for import</strong></p>
        <p>
          We found <strong>{queItems.length}</strong> contacts on the remote server that can be added to your vault.
        </p>
      </div>
      <div className="action-card-actions">
        <button className="action-card-button " onClick={addVcardsToVault()}>
          Import All
        </button>
      </div>
    </div>
  );
}

type PropsRender = {
  queItem: InsightQueItem;
  dismissItem: () => void; // Callback for done or close
};

const render = ({queItem, dismissItem}: PropsRender): JSX.Element | null => {
  const addVcardToVault = () => {
    return async (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      await ImportUnknownVcardToVault(queItem);
    }
  }

  return (
    <div className="action-card">
      <div className="action-card-content">
        <p><b>{queItem.data.fn}</b> is available on the remote server.</p>
      </div>
      <div className="modal-close-button"
           tabIndex={0}
           role="button"
           aria-label="Close"
           onClick={dismissItem}>
      </div>
      <div className="action-card-actions">
        <button className="action-card-button" onClick={addVcardToVault()}>Add to Vault</button>
      </div>
    </div>
  );
}

export const SyncUnknownProcessor: InsightProcessor = {
  name: "SyncUnknownProcessor",
  runType: RunType.BATCH,
  settingPropertyName: 'SyncUnknownProcessor',
  settingDescription: 'query the configured remote contact server and allow you to decide to import ',
  settingDefaultValue: true,

  render,
  renderGroup,


  async process(contacts: Contact[]): Promise<void> {
    function isEnabled(settingPropertyName: string) {
      const setting = getSettings();
      const processorActive = setting.processors[`${settingPropertyName}`] as boolean;
      const syncEnabled = isSyncAvailable();
      return processorActive && syncEnabled;
    }

    if (!isEnabled(this.settingPropertyName)) {
      return;
    }

    const unknownContacts = await sync.getUnknownFromRemote(contacts);
    if (unknownContacts.length === 0) {
      return;
    }

    unknownContacts.map(async (unknownContact) => {
      await insightQueueStore.set({
        name: this.name,
        runType: this.runType,
        file: undefined,
        message: `${unknownContact.fn} is available on remote.`,
        data: unknownContact,
      })
    });
  },

};
