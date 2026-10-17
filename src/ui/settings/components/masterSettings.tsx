import { App, Setting } from "obsidian";
import * as React from "react";
import { getSettings, updateSetting } from "src/context/sharedSettingsContext";
import { contactNotes } from "src/contacts/obsidianNotes";
import { normalizeFolder } from "src/contacts/moveContacts";
import { insightQueueStore } from "src/insights/insightsQueStore";
import { FolderSuggest } from "src/settings/FolderSuggest";
import { confirmMoveContacts } from "src/ui/modals/moveContactsModal";

interface MasterSettingProps {
  app: App;
}


export function MasterSetting({ app }: MasterSettingProps) {

  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (containerRef.current) {
      containerRef.current.innerHTML = "";

      const folderDesc = document.createDocumentFragment();
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
            confirmMoveContacts(app, count, previous, value, () => void setFolder(value), "Don't move");
          };

          new FolderSuggest(app, cb.inputEl, (folder) => {
            cb.setValue(folder);
            commit(folder);
          });
          cb.inputEl.addEventListener('focus', () => {
            activeFolder = getSettings().contactsFolder;
          });
          cb.inputEl.addEventListener('blur', () => commit(cb.inputEl.value));
          cb.setPlaceholder("Example: Contacts")
            .setValue(getSettings().contactsFolder)
            .onChange(async(value) => {
              if(value === '') {
                await updateSetting('contactsFolder', '');
              }
            });
        });

      const hashtagDesc = document.createDocumentFragment();
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
    }
  }, []);

  return <div ref={containerRef} />;
}


