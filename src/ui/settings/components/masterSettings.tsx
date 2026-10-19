import { App, Setting } from "obsidian";
import * as React from "react";
import { getSettings, updateSetting } from "src/context/sharedSettingsContext";
import { contactNotes } from "src/contacts/obsidianNotes";
import { normalizeFolder } from "src/contacts/moveContacts";
import { insightQueueStore } from "src/insights/insightsQueStore";
import { FolderSuggest } from "src/settings/FolderSuggest";
import { contactNameByUid } from "src/graph/vaultGraph";
import { MePickerModal } from "src/ui/modals/mePickerModal";
import { fragmentFor } from "src/ui/dom";
import { confirmMoveContacts } from "src/ui/modals/moveContactsModal";

interface MasterSettingProps {
  app: App;
}


export function MasterSetting({ app }: MasterSettingProps) {

  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (containerRef.current) {
      containerRef.current.innerHTML = "";

      const folderDesc = fragmentFor(containerRef.current);
      folderDesc.append(
        "New contacts will be saved here.",
        folderDesc.createEl("br"),
        "If empty, contacts will be created in the root of your vault."
      );

      new Setting(containerRef.current)
        .setName("Contacts folder location")
        .setDesc(folderDesc)
        .addSearch((cb) => {
          // The folder that was active when the field got focus; the move starts from there.
          let activeFolder = getSettings().contactsFolder;

          const setFolder = async (folder: string) => {
            await updateSetting('contactsFolder', folder);
            insightQueueStore.clear();
          };

          // Offers to move the contacts when a different, existing folder was chosen; otherwise only the setting changes.
          const commit = (raw: string) => {
            const value = normalizeFolder(raw);
            const previous = activeFolder;
            if (normalizeFolder(previous) === value) return;
            if (value !== '' && !app.vault.getFolderByPath(value)) return;
            activeFolder = value;
            const count = contactNotes(app, previous).length;
            if (count === 0) {
              void setFolder(value);
              return;
            }
            confirmMoveContacts(app, count, previous, value, () => void setFolder(value), "Don't move", (result) => {
              // Nothing moved: the setting stayed, so show the folder that is still in use.
              if (result.moved === 0) {
                activeFolder = previous;
                cb.setValue(previous);
              }
            });
          };

          let selections = 0;
          new FolderSuggest(app, cb.inputEl, (folder) => {
            selections++;
            cb.setValue(folder);
            commit(folder);
          });
          cb.inputEl.addEventListener('focus', () => {
            activeFolder = getSettings().contactsFolder;
          });
          cb.inputEl.addEventListener('blur', () => {
            // Wait a tick: a suggestion picked right after typing must win over the typed text.
            const seen = selections;
            setTimeout(() => {
              if (selections === seen) commit(cb.inputEl.value);
            }, 0);
          });
          cb.setPlaceholder("Example: Contacts")
            .setValue(getSettings().contactsFolder)
            .onChange(async(value) => {
              if(value === '') {
                await updateSetting('contactsFolder', '');
              }
            });
        });

      const hashtagDesc = fragmentFor(containerRef.current);
      hashtagDesc.append(
        "New contacts are automatically tagged with this hashtags.",
        hashtagDesc.createEl("br"),
        "The hashtags are inserted at the end of the note.",
        hashtagDesc.createEl("br"),
        hashtagDesc.createEl("br"),
        hashtagDesc.createEl("strong", {
          text: "Attention: ",
        }),
        "You must include the ",
        hashtagDesc.createEl("code", { text: "#" }),
        "-sign"
      );

      new Setting(containerRef.current)
        .setName("Default hashtags")
        .setDesc(hashtagDesc)
        .addText(text => text
          .setPlaceholder("")
          .setValue(getSettings().defaultHashtag)
          .onChange(async (value) => {
            await updateSetting('defaultHashtag', value);
          }));

      // "This is me": the people graph is drawn around this contact. Stored as the contact's UID.
      const meSetting = new Setting(containerRef.current).setName("This is me");
      const showMe = () => {
        const uid = getSettings().meUid;
        const name = uid === '' ? undefined : contactNameByUid(app, uid);
        meSetting.setDesc(
          uid === ''
            ? "The people graph centres on you. Not chosen: it centres on the contact you have open."
            : name !== undefined
              ? `The people graph centres on ${name}.`
              : "The chosen contact was not found. Choose again or clear.",
        );
      };
      const saveMe = async (uid: string) => {
        await updateSetting('meUid', uid);
        showMe();
      };
      meSetting
        .addButton((button) => button.setButtonText("Choose").onClick(() => {
          new MePickerModal(app, (candidate) => void saveMe(candidate.uid)).open();
        }))
        .addButton((button) => button.setButtonText("Clear").onClick(() => void saveMe('')));
      showMe();
    }
  }, []);

  return <div ref={containerRef} />;
}


