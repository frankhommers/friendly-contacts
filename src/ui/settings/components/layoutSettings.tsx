import { App, Notice } from "obsidian";
import * as React from "react";
import { folderNotesSettings } from "src/contacts/folderNotesPlugin";
import { differsFromFolderNotes, fromFolderNotes, LayoutSettings, validateLayout } from "src/contacts/layout";
import { contactsInOtherFolders } from "src/contacts/layoutNotes";
import { getSettings, setSettings } from "src/context/sharedSettingsContext";

interface LayoutSettingsProps {
  app: App;
  /** Called after the layout choice itself was saved as a different value. */
  onLayoutChanged?: (from: LayoutSettings["layout"], to: LayoutSettings["layout"]) => void | Promise<void>;
}

const NAME_TOKEN = "{{name}}";

export function LayoutSettingsSection({ app, onLayoutChanged }: LayoutSettingsProps) {
  const [draft, setDraft] = React.useState<LayoutSettings>(() => getSettings().layout);
  // Read once when the section opens: the plugin's settings do not change while this tab is shown.
  const folderNotes = React.useMemo(() => folderNotesSettings(app), [app]);
  const [differs, setDiffers] = React.useState(() => differsFromFolderNotes(folderNotes, getSettings().layout));
  const [inOtherFolders, setInOtherFolders] = React.useState(() => contactsInOtherFolders(app));

  const problem = validateLayout(draft);

  /** Shows `next`; saves it when it is usable. */
  const commit = async (next: LayoutSettings) => {
    setDraft(next);
    if (validateLayout(next) !== undefined) return;
    const current = getSettings();
    const from = current.layout.layout;
    await setSettings({ ...current, layout: { ...next, noteName: next.noteName.trim() } });
    setDiffers(differsFromFolderNotes(folderNotes, next));
    setInOtherFolders(contactsInOtherFolders(app));
    if (from !== next.layout) await onLayoutChanged?.(from, next.layout);
  };

  const copyFromFolderNotes = async () => {
    const mapped = fromFolderNotes(folderNotes);
    if (!mapped.ok) {
      new Notice(mapped.reason);
      return;
    }
    await commit({ ...draft, ...mapped.settings });
  };

  const fixedName = draft.layout === "folder" && problem === undefined && !draft.noteName.includes(NAME_TOKEN);

  return (
    <>
      <div className="setting-item setting-item-heading">
        <div className="setting-item-info">
          <div className="setting-item-name">Contact layout</div>
          <div className="setting-item-description">
            Keep each contact as one note, or in a folder of its own with a folder note.
          </div>
        </div>
      </div>

      <div className="setting-item">
        <div className="setting-item-info">
          <div className="setting-item-name">Layout</div>
          <div className="setting-item-description">
            New contacts follow this. Existing contacts stay where they are until you move them.
          </div>
        </div>
        <div className="setting-item-control">
          <select
            className="dropdown"
            aria-label="Layout"
            value={draft.layout}
            onChange={(e) => commit({ ...draft, layout: e.target.value as LayoutSettings["layout"] })}
          >
            <option value="note">One note per contact</option>
            <option value="folder">Folder per contact</option>
          </select>
        </div>
      </div>

      <div className="setting-item">
        <div className="setting-item-info">
          <div className="setting-item-name">Folder note name</div>
          <div className="setting-item-description">
            The file name of the folder note, without .md. <code>{NAME_TOKEN}</code> is the contact's name.
            {problem ? <div className="mod-warning">{problem}. This is not saved until it is fixed.</div> : null}
            {fixedName ? <div>Obsidian's graph and tabs will show every contact as "{draft.noteName.trim()}".</div> : null}
          </div>
        </div>
        <div className="setting-item-control">
          <input
            type="text"
            aria-label="Folder note name"
            value={draft.noteName}
            onChange={(e) => setDraft({ ...draft, noteName: e.target.value })}
            onBlur={() => draft.noteName !== getSettings().layout.noteName && commit(draft)}
          />
        </div>
      </div>

      <div className="setting-item">
        <div className="setting-item-info">
          <div className="setting-item-name">Folder note location</div>
          {inOtherFolders > 0 ? (
            <div className="setting-item-description">
              <div className="mod-warning">
                {inOtherFolders} contacts are in folders made with other settings. They are not put in folders
                again, and a rename through Sync renames only their note.
              </div>
            </div>
          ) : null}
        </div>
        <div className="setting-item-control">
          <select
            className="dropdown"
            aria-label="Folder note location"
            value={draft.location}
            onChange={(e) => commit({ ...draft, location: e.target.value as LayoutSettings["location"] })}
          >
            <option value="inside">Inside the folder</option>
            <option value="next">Next to the folder</option>
          </select>
        </div>
      </div>

      {folderNotes !== undefined && (
        <div className="setting-item">
          <div className="setting-item-info">
            <div className="setting-item-name">Folder Notes plugin</div>
            <div className="setting-item-description">
              {differs ? <div className="mod-warning">Folder Notes uses different settings.</div> : null}
            </div>
          </div>
          <div className="setting-item-control">
            <button onClick={copyFromFolderNotes}>Copy from Folder Notes</button>
          </div>
        </div>
      )}
    </>
  );
}
