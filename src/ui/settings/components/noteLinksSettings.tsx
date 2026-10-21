import { App } from "obsidian";
import * as React from "react";
import { NoteLinksSettings as NoteLinksValue, setLinkVault, turnNoteLinks } from "src/contacts/friendly/noteLinks";
import { getSettings, setSettings } from "src/context/sharedSettingsContext";
import { useSettings } from "src/ui/hooks/settingsHook";
import { CommitInput } from "src/ui/settings/components/commitInput";

const NAME = "Links to Obsidian notes on cards";
const VAULT_NAME = "Vault name on your phone";

/** "Links to Obsidian notes on cards": the switch, and while it is on the name of this vault on the phone. */
export function NoteLinksSettings({ app }: { app: App }) {
  // Shows what is stored: a save here, and a reload after data.json changed on disk, both show up.
  const links = useSettings()?.noteLinks ?? getSettings().noteLinks;

  /** Saves what `change` makes of the stored settings. */
  const save = async (change: (stored: NoteLinksValue) => NoteLinksValue) => {
    const current = getSettings();
    await setSettings({ ...current, noteLinks: change(current.noteLinks) });
  };

  return (
    <>
      <div className="setting-item">
        <div className="setting-item-info">
          <div className="setting-item-name">{NAME}</div>
          <div className="setting-item-description">
            Adds a website to each card for every relationship with a contact note: an obsidian:// link to that note,
            labelled with the person's name. On Android (DAVx5) you tap it to open the note. Cards get or lose the
            links at each contact's next Sync.
          </div>
        </div>
        <div className="setting-item-control">
          <div
            className={`checkbox-container${links.enabled ? " is-enabled" : ""}`}
            role="switch"
            aria-label={NAME}
            aria-checked={links.enabled}
            tabIndex={0}
            onClick={() => { void save((stored) => turnNoteLinks(stored, !stored.enabled, app.vault.getName())); }}
          >
            <input type="checkbox" tabIndex={0} checked={links.enabled} readOnly />
          </div>
        </div>
      </div>

      {links.enabled && (
        <div className="setting-item">
          <div className="setting-item-info">
            <div className="setting-item-name">{VAULT_NAME}</div>
            <div className="setting-item-description">
              The name of this vault in Obsidian on your phone. Links open the note in the vault with this name.
            </div>
          </div>
          <div className="setting-item-control">
            <CommitInput
              label={VAULT_NAME}
              value={links.vaultName}
              onCommit={(text) => { void save((stored) => setLinkVault(stored, text, app.vault.getName())); }}
            />
          </div>
        </div>
      )}
    </>
  );
}
