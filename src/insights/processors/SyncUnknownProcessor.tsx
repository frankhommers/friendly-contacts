import {Contact} from "src/contacts";
import {getSettings} from "src/context/sharedSettingsContext";
import {InsightProcessor, PropsRender, PropsRenderGroup, RunType} from "src/insights/insight.d";
import {insightQueueStore} from "src/insights/insightsQueStore";
import {sync} from "src/sync";
import {isSyncAvailable} from "src/sync/adapters";

// The Import panel lists these cards itself (see ImportView); nothing is drawn per insight.
const render = (_props: PropsRender): JSX.Element | null => null;
const renderGroup = (_props: PropsRenderGroup): JSX.Element | null => null;

export const SyncUnknownProcessor: InsightProcessor = {
  name: "SyncUnknownProcessor",
  title: "Look for contacts to import",
  runType: RunType.BATCH,
  settingPropertyName: 'SyncUnknownProcessor',
  settingDescription: 'Looks on your address books for contacts that have no note yet and lists them in the Import panel.',
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
