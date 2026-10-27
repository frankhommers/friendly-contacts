import { App, Notice } from "obsidian";
import * as React from "react";
import { cardVersions } from "src/contacts/obsidianNotes";
import { notesNamingSource, removalRefusal, removeSource, renameRefusal, renameSource, saveSourcePatch } from "src/contacts/sourceNotes";
import { getSettings, setSettings } from "src/context/sharedSettingsContext";
import {
  connectionLabel,
  hasStoredCredentials,
  resolveCredentials,
  StoredCredentials,
  usernameFromAuthKey,
} from "src/settings/carddavCredentials";
import { ContactsPluginSettings, Source } from "src/settings/settings";
import { connectionProblem } from "src/sync/adapters";
import {
  cardVersionStats,
  followsBook,
  newCardVersion,
  SourcePatch,
  sourceWithSameUrl,
  uniqueSourceName,
  validateSourceName,
  withSource,
} from "src/sync/sources";
import { ConfirmModal } from "src/ui/modals/confirmModal";
import CarddavSettings, { CarddavSettingsInterface } from "src/ui/settings/components/carddavSettings";
import { generateUUID } from "src/util/vcard";
import { secretStore } from "src/settings/secretStore";

/** Secrets are never shown again; the username is recovered from the saved basic auth key. */
function formFromSource(source: Source): CarddavSettingsInterface {
  return {
    addressBookUrl: source.addressBookUrl,
    username: source.authType === 'basic' ? usernameFromAuthKey(source.authKey) : '',
    password: '',
    apiKey: '',
  };
}

interface SourceBlockProps {
  app: App;
  source: Source;
  isDefault: boolean;
  /** Saves only the fields that changed, into the current entry of this source. */
  onSave: (patch: SourcePatch) => Promise<void>;
  onMakeDefault: () => Promise<void>;
  onChanged: () => void;
}

/** Runs an action; an error becomes a Notice instead of an unhandled rejection. */
async function attempt(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    new Notice(`Address book: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function SourceBlock({ app, source, isDefault, onSave, onMakeDefault, onChanged }: SourceBlockProps) {
  const [name, setName] = React.useState(source.name);
  const [nameError, setNameError] = React.useState('');
  const [warning, setWarning] = React.useState('');
  const [form, setForm] = React.useState<CarddavSettingsInterface>(() => formFromSource(source));
  const saved: StoredCredentials = { authType: source.authType, authKey: source.authKey };

  React.useEffect(() => { setName(source.name); }, [source.name]);

  const commitName = () => attempt(async () => {
    const wanted = name.trim();
    if (wanted === source.name) {
      setName(wanted);
      setNameError('');
      return;
    }
    const problem = validateSourceName(wanted, getSettings().sources, source.id);
    if (problem) {
      setNameError(problem);
      return;
    }
    setNameError('');
    const from = source.name;
    const refused = renameRefusal(app, from, wanted);
    if (refused) {
      new Notice(refused);
      setName(source.name);
      return;
    }
    const count = notesNamingSource(app, from).length;
    const rename = () => attempt(async () => {
      const result = await renameSource(app, source.id, wanted);
      if ('refused' in result) {
        new Notice(result.refused);
        setName(source.name);
        return;
      }
      const { renamed, failed } = result;
      onChanged();
      if (failed.length > 0) console.log(`Friendly Contacts: not renamed in:\n${failed.join('\n')}`);
      if (count > 0) {
        new Notice(`Renamed ${from} to ${wanted} in ${renamed} contact notes`
          + (failed.length > 0 ? `; ${failed.length} failed, see console` : ''));
      }
    });
    if (count === 0) {
      await rename();
      return;
    }
    new ConfirmModal(app, `Rename ${from} to ${wanted} in ${count} contact notes?`, 'Rename', rename, 'Cancel', () => setName(source.name)).open();
  });

  const enable = () => attempt(async () => {
    const resolved = resolveCredentials(form, saved);
    if (!resolved.ok) {
      setWarning(resolved.error);
      return;
    }
    const twin = sourceWithSameUrl(getSettings().sources, form.addressBookUrl, source.id);
    if (twin) {
      new Notice(`Not enabled: ${twin.name} already uses this address book URL.`);
      return;
    }
    const connection = { addressBookUrl: form.addressBookUrl, authType: resolved.authType, authKey: resolved.authKey };
    const problem = await connectionProblem(connection);
    if (problem) {
      setWarning(problem);
      return;
    }
    setWarning('');
    setForm(formFromSource({ ...source, ...connection }));
    await onSave({ ...connection, enabled: true });
  });

  const disable = () => attempt(() => onSave({ enabled: false }));

  const forgetSaved = () => attempt(() => onSave({ authKey: '' }));

  /** "Count card versions": the versions found, or why they could not be read. */
  const [counted, setCounted] = React.useState<{ versions?: (string | undefined)[]; counting?: boolean; error?: string }>();
  const countVersions = async () => {
    setCounted({ counting: true });
    try {
      setCounted({ versions: await cardVersions(source, { fresh: true }) });
    } catch (error) {
      setCounted({ error: error instanceof Error ? error.message : String(error) });
    }
  };
  const countedText = (): string | undefined => {
    if (counted?.counting) return 'Counting…';
    if (counted?.error !== undefined) return `Could not count: ${counted.error}`;
    if (!counted?.versions) return undefined;
    const auto = followsBook(source) ? `; Automatic gives new contacts vCard ${newCardVersion(source, counted.versions)}` : '';
    return `${cardVersionStats(counted.versions)}${auto}.`;
  };

  const remove = () => attempt(async () => {
    const refused = await removalRefusal(app, source.id);
    if (refused) {
      new Notice(refused);
      return;
    }
    new ConfirmModal(app, `Remove ${source.name}? Its synchronization state is deleted too.`, 'Remove', () => attempt(async () => {
      const outcome = await removeSource(app, source.id);
      if ('refused' in outcome) new Notice(outcome.refused);
      onChanged();
    })).open();
  });

  return (
    <div className="vcf-source">
      <div className="setting-item setting-item-heading js-keep">
        <div className="setting-item-info">
          <div className="setting-item-name">
            {source.name}
            {isDefault ? <span className="vcf-source-badge">default</span> : null}
          </div>
          <div className="setting-item-description">
            {source.enabled
              ? <div className="mod-success">Sync on. {connectionLabel(saved)}.</div>
              : <div>Sync off. Fill in the connection below and press Enable.</div>}
            {warning ? <div className="mod-warning">{warning}</div> : null}
          </div>
        </div>
        <div className="setting-item-control">
          {source.enabled
            ? <button className="mod-destructive" onClick={() => { void disable(); }}>Disable</button>
            : <button className="mod-cta" onClick={() => { void enable(); }}>Enable</button>}
        </div>
      </div>

      <div className="setting-item js-keep">
        <div className="setting-item-info">
          <div className="setting-item-name">Name</div>
          <div className="setting-item-description">
            Notes refer to this address book with <code>source: {source.name}</code>.
            {source.enabled ? <div>Disable sync to change the connection settings.</div> : null}
            {nameError ? <div className="mod-warning">{nameError}</div> : null}
          </div>
        </div>
        <div className="setting-item-control">
          <input
            className="textfield"
            type="text"
            aria-label="Address book name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => { void commitName(); }}
          />
        </div>
      </div>

      <CarddavSettings
        carddavSettings={form}
        setCarddavSettings={setForm}
        savedAuthType={hasStoredCredentials(saved) ? saved.authType : undefined}
        locked={source.enabled}
        onForgetSaved={() => { void forgetSaved(); }}
        keychain={secretStore() !== undefined}
      />

      <div className="setting-item">
        <div className="setting-item-info">
          <div className="setting-item-name">Default for new contacts</div>
          <div className="setting-item-description">
            {isDefault
              ? "New contacts are created in this address book."
              : "Turn on to create new contacts in this address book instead."}
          </div>
        </div>
        <div className="setting-item-control">
          <div
            className={`checkbox-container${isDefault ? " is-enabled" : ""}`}
            role="switch"
            aria-checked={isDefault}
            aria-disabled={isDefault}
            aria-label={`Make ${source.name} the default address book`}
            tabIndex={0}
            onClick={() => { if (!isDefault) void attempt(onMakeDefault); }}
            onKeyDown={(e) => { if (!isDefault && (e.key === " " || e.key === "Enter")) { e.preventDefault(); void attempt(onMakeDefault); } }}
          >
            <input type="checkbox" tabIndex={-1} checked={isDefault} readOnly />
          </div>
        </div>
      </div>

      <div className="setting-item">
        <div className="setting-item-info">
          <div className="setting-item-name">New contacts</div>
          <div className="setting-item-description">
            The vCard version of contacts created in this address book. Automatic uses the version most of its
            cards have (vCard 3.0 when it is empty or there is a tie).
            {countedText() !== undefined
              ? <div className={counted?.error !== undefined ? "mod-warning" : undefined}>{countedText()}</div>
              : null}
          </div>
        </div>
        <div className="setting-item-control">
          <button
            disabled={counted?.counting === true || source.addressBookUrl.trim() === ''}
            onClick={() => { void countVersions(); }}
          >
            Count card versions
          </button>
          <select
            className="dropdown"
            aria-label={`vCard version of new contacts in ${source.name}`}
            value={source.newCardVersion ?? 'auto'}
            onChange={(e) => { void attempt(() => onSave({ newCardVersion: e.target.value as NonNullable<Source['newCardVersion']> })); }}
          >
            <option value="auto">Automatic</option>
            <option value="3.0">vCard 3.0</option>
            <option value="4.0">vCard 4.0</option>
          </select>
        </div>
      </div>

      <div className="setting-item">
        <div className="setting-item-info">
          <div className="setting-item-name">Remove address book</div>
          <div className="setting-item-description">
            {isDefault
              ? "The default address book cannot be removed. Make another one the default first."
              : "Removes it from Friendly Contacts. The cards on the server stay."}
          </div>
        </div>
        <div className="setting-item-control">
          <button className="mod-warning" disabled={isDefault} onClick={() => { void remove(); }}>Remove</button>
        </div>
      </div>
    </div>
  );
}

export function SourcesSettings({ app }: { app: App }) {
  const [state, setState] = React.useState(() => {
    const { sources, defaultSource } = getSettings();
    return { sources, defaultSource };
  });

  const refresh = () => {
    const { sources, defaultSource } = getSettings();
    setState({ sources, defaultSource });
  };

  const save = async (next: ContactsPluginSettings) => {
    await setSettings(next);
    refresh();
  };

  const add = () => {
    const current = getSettings();
    const source: Source = {
      id: generateUUID(),
      name: uniqueSourceName(current.sources),
      addressBookUrl: '',
      authType: 'apikey',
      authKey: '',
      enabled: false,
    };
    return save(withSource(current, source));
  };

  return (
    <>
      <div className="setting-item setting-item-heading js-keep">
        <div className="setting-item-info">
          <div className="setting-item-name">Address books</div>
          <div className="setting-item-description">Each address book is a CardDAV address book on a server. New contacts go to the default one.</div>
        </div>
      </div>
      {state.sources.map((source) => (
        <SourceBlock
          key={source.id}
          app={app}
          source={source}
          isDefault={source.id === state.defaultSource}
          onSave={async (patch) => {
            if (!(await saveSourcePatch(source.id, patch))) new Notice('This address book no longer exists.');
            refresh();
          }}
          onMakeDefault={() => save({ ...getSettings(), defaultSource: source.id })}
          onChanged={refresh}
        />
      ))}
      <div className="setting-item js-keep">
        <div className="setting-item-info">
          <div className="setting-item-description">Another address book, for example a shared family book or one on another server.</div>
        </div>
        <div className="setting-item-control">
          <button className="mod-cta" onClick={() => { void attempt(add); }}>Add address book</button>
        </div>
      </div>
    </>
  );
}
