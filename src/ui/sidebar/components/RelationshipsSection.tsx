import { Notice, TFile } from "obsidian";
import * as React from "react";
import { obsidianMirrorEnv, RemoteContact } from "src/contacts/obsidianNotes";
import {
  ghostAction,
  linkRelationEntry,
  RelationGroup,
  relationGroups,
  RelationPerson,
  removeRelationEntry,
} from "src/contacts/relationEdit";
import { getApp } from "src/context/sharedAppContext";
import { getSettings } from "src/context/sharedSettingsContext";
import { openFile } from "src/file/file";
import { useSyncEnabled } from "src/ui/hooks/syncEnabledHook";
import { AddRelationshipModal, nameOfPath } from "src/ui/modals/addRelationshipModal";
import { ConfirmModal } from "src/ui/modals/confirmModal";
import { importFromServer } from "src/ui/modals/importContactModal";
import { contactsVersion, listRemoteForSidebar, notePathsByUid } from "src/ui/sidebar/relationsData";

type Props = { file: TFile };

/** The version of the contact notes, shared by every card (one subscription for the whole sidebar). */
function useContactsVersion(): number {
  const store = contactsVersion(getApp());
  return React.useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** The note's relationship groups, recomputed when a contact note changes (this one, or one it links to). */
function useRelationGroups(file: TFile, version: number): RelationGroup[] {
  const app = getApp();
  return React.useMemo(() => {
    const frontmatter = { ...(app.metadataCache.getFileCache(file)?.frontmatter ?? {}) };
    return relationGroups(obsidianMirrorEnv(app), getSettings().friendly.mapping, file.path, frontmatter, (path) =>
      nameOfPath(app, path),
    );
    // `version` stands for the metadata read here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, file, file.path, version]);
}

/** The contacts on the servers, fetched once there is an unresolved name to look for (shared, see relationsData). */
function useRemoteContacts(wanted: boolean): RemoteContact[] {
  const [remote, setRemote] = React.useState<RemoteContact[]>([]);
  React.useEffect(() => {
    if (!wanted) return;
    let cancelled = false;
    void listRemoteForSidebar().then((list) => {
      if (!cancelled) setRemote(list);
    });
    return () => {
      cancelled = true;
    };
  }, [wanted]);
  return remote;
}

/** Runs a vault change; a failure is logged and told in a Notice. */
async function attempt(action: Promise<void>, failure: string): Promise<void> {
  try {
    await action;
  } catch (error) {
    console.error(`Friendly Contacts: ${failure}`, error);
    new Notice(`${failure}, see console`);
  }
}

export const RelationshipsSection = ({ file }: Props) => {
  const app = getApp();
  const syncEnabled = useSyncEnabled();
  const version = useContactsVersion();
  const groups = useRelationGroups(file, version);
  const hasUnresolved = groups.some((group) => group.people.some((person) => person.path === undefined));
  const remote = useRemoteContacts(syncEnabled && hasUnresolved);
  const [busy, setBusy] = React.useState<Set<string>>(new Set());

  const stop = (event: React.SyntheticEvent) => event.stopPropagation();
  const addButton = (
    <button className="friendly-relationships-add" onClick={() => new AddRelationshipModal(app, file.path).open()}>
      + Relationship
    </button>
  );
  if (groups.length === 0) {
    return (
      <div className="friendly-relationships is-empty" onClick={stop} onContextMenu={stop}>
        {addButton}
      </div>
    );
  }

  const notePaths = syncEnabled && remote.length > 0 ? notePathsByUid(app, version) : undefined;

  const open = (person: RelationPerson) => {
    const target = person.path === undefined ? undefined : app.vault.getAbstractFileByPath(person.path);
    if (target instanceof TFile) void openFile(target, app.workspace);
  };

  const remove = (group: RelationGroup, person: RelationPerson) => {
    new ConfirmModal(app, `Remove ${person.display} from ${group.property}?`, "Remove", () => {
      const removing = removeRelationEntry(
        obsidianMirrorEnv(app),
        getSettings().friendly.mapping,
        file.path,
        group.property,
        person.text,
      );
      void attempt(removing, `Removing ${person.display} failed`);
    }).open();
  };

  /** Disables the person's button while `work` runs. */
  const whileBusy = (key: string, work: () => Promise<void>) => {
    setBusy((current) => new Set(current).add(key));
    void work().finally(() =>
      setBusy((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      }),
    );
  };

  const link = (group: RelationGroup, person: RelationPerson, notePath: string) => {
    const env = obsidianMirrorEnv(app);
    const rows = getSettings().friendly.mapping;
    const linking = linkRelationEntry(env, rows, file.path, group.property, person.text, notePath);
    return attempt(linking, `Linking ${person.display} failed`);
  };

  return (
    <div className="friendly-relationships" onClick={stop} onContextMenu={stop}>
      <div className="friendly-relationships-header">
        <span className="friendly-relationships-title">Relationships</span>
        {addButton}
      </div>
      {groups.map((group) => (
        <div className="friendly-relationships-group" key={group.property}>
          <span className="friendly-relationships-label">{group.property}</span>
          <span className="friendly-relationships-people">
            {group.people.map((person, index) => {
              const key = `${group.property}\u0000${person.text}`;
              const action =
                notePaths !== undefined && person.path === undefined
                  ? ghostAction(person.text, remote, (uid) => notePaths.get(uid), file.path)
                  : undefined;
              return (
                <span className="friendly-relationships-person" key={`${key}\u0000${index}`}>
                  {person.path === undefined ? (
                    <span className="friendly-relationships-name is-unresolved">{person.display}</span>
                  ) : (
                    <a className="friendly-relationships-name" onClick={() => open(person)}>
                      {person.display}
                    </a>
                  )}
                  {action !== undefined && "import" in action ? (
                    <button
                      className="friendly-relationships-import"
                      disabled={busy.has(key)}
                      onClick={() => whileBusy(key, () => importFromServer(app, action.import))}
                    >
                      Import
                    </button>
                  ) : null}
                  {action !== undefined && "link" in action ? (
                    <button
                      className="friendly-relationships-link"
                      aria-label={`Link to ${nameOfPath(app, action.link)}`}
                      disabled={busy.has(key)}
                      onClick={() => whileBusy(key, () => link(group, person, action.link))}
                    >
                      Link
                    </button>
                  ) : null}
                  <span
                    className="friendly-relationships-remove clickable-icon"
                    aria-label={`Remove ${person.display}`}
                    onClick={() => remove(group, person)}
                  >
                    ×
                  </span>
                </span>
              );
            })}
          </span>
        </div>
      ))}
    </div>
  );
};
