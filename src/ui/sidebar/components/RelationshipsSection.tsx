import { TFile } from "obsidian";
import * as React from "react";
import { obsidianMirrorEnv, RemoteContact, remoteContacts } from "src/contacts/obsidianNotes";
import { RelationGroup, relationGroups, RelationPerson, remoteCardFor, removeRelationEntry } from "src/contacts/relationEdit";
import { getApp } from "src/context/sharedAppContext";
import { getSettings } from "src/context/sharedSettingsContext";
import { openFile } from "src/file/file";
import { useSyncEnabled } from "src/ui/hooks/syncEnabledHook";
import { AddRelationshipModal, nameOfPath } from "src/ui/modals/addRelationshipModal";
import { ConfirmModal } from "src/ui/modals/confirmModal";
import { importFromServer } from "src/ui/modals/importContactModal";

type Props = { file: TFile };

/** The note's relationship groups, recomputed when this note's metadata changes (or links resolve). */
function useRelationGroups(file: TFile): RelationGroup[] {
  const app = getApp();
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    const refresh = () => setTick((n) => n + 1);
    const onChanged = (changed: TFile) => {
      if (changed.path === file.path) refresh();
    };
    const changedRef = app.metadataCache.on("changed", onChanged);
    // A note created or renamed elsewhere can resolve (or break) a link here without this note changing.
    const resolvedRef = app.metadataCache.on("resolved", refresh);
    return () => {
      app.metadataCache.offref(changedRef);
      app.metadataCache.offref(resolvedRef);
    };
  }, [app, file.path]);

  return React.useMemo(() => {
    const frontmatter = { ...(app.metadataCache.getFileCache(file)?.frontmatter ?? {}) };
    return relationGroups(obsidianMirrorEnv(app), getSettings().friendly.mapping, file.path, frontmatter, (path) =>
      nameOfPath(app, path),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, file, file.path, tick]);
}

let inFlight: Promise<RemoteContact[]> | undefined;

/** One server listing shared by every section asking at the same time (the sidebar shows many contacts). */
function listRemote(): Promise<RemoteContact[]> {
  inFlight ??= remoteContacts().finally(() => {
    inFlight = undefined;
  });
  return inFlight;
}

/** The contacts on the servers, fetched once there is an unresolved name to look for (cached for a while). */
function useRemoteContacts(wanted: boolean): RemoteContact[] {
  const [remote, setRemote] = React.useState<RemoteContact[]>([]);
  React.useEffect(() => {
    if (!wanted) return;
    let cancelled = false;
    listRemote()
      .then((list) => {
        if (!cancelled) setRemote(list);
      })
      .catch((error) => console.error("Friendly Contacts: could not list the server contacts", error));
    return () => {
      cancelled = true;
    };
  }, [wanted]);
  return remote;
}

export const RelationshipsSection = ({ file }: Props) => {
  const app = getApp();
  const syncEnabled = useSyncEnabled();
  const groups = useRelationGroups(file);
  const hasUnresolved = groups.some((group) => group.people.some((person) => person.path === undefined));
  const remote = useRemoteContacts(syncEnabled && hasUnresolved);
  const [importing, setImporting] = React.useState<Set<string>>(new Set());

  const open = (person: RelationPerson) => {
    const target = person.path === undefined ? undefined : app.vault.getAbstractFileByPath(person.path);
    if (target instanceof TFile) void openFile(target, app.workspace);
  };

  const remove = (group: RelationGroup, person: RelationPerson) => {
    new ConfirmModal(app, `Remove ${person.display} from ${group.property}?`, "Remove", () => {
      void removeRelationEntry(obsidianMirrorEnv(app), getSettings().friendly.mapping, file.path, group.property, person.text);
    }).open();
  };

  const importPerson = (card: RemoteContact, key: string) => {
    setImporting((current) => new Set(current).add(key));
    void importFromServer(app, card).finally(() =>
      setImporting((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      }),
    );
  };

  const stop = (event: React.SyntheticEvent) => event.stopPropagation();

  return (
    <div className="friendly-relationships" onClick={stop} onContextMenu={stop}>
      <div className="friendly-relationships-header">
        <span className="friendly-relationships-title">Relationships</span>
        <button className="friendly-relationships-add" onClick={() => new AddRelationshipModal(app, file.path).open()}>
          + Relationship
        </button>
      </div>
      {groups.map((group) => (
        <div className="friendly-relationships-group" key={group.property}>
          <span className="friendly-relationships-label">{group.property}</span>
          <span className="friendly-relationships-people">
            {group.people.map((person, index) => {
              const key = `${group.property}\u0000${person.text}`;
              const card = syncEnabled && person.path === undefined ? remoteCardFor(person.text, remote) : undefined;
              return (
                <span className="friendly-relationships-person" key={`${key}\u0000${index}`}>
                  {person.path === undefined ? (
                    <span className="friendly-relationships-name is-unresolved">{person.display}</span>
                  ) : (
                    <a className="friendly-relationships-name" onClick={() => open(person)}>
                      {person.display}
                    </a>
                  )}
                  {card !== undefined ? (
                    <button
                      className="friendly-relationships-import"
                      disabled={importing.has(key)}
                      onClick={() => importPerson(card, key)}
                    >
                      Import
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
