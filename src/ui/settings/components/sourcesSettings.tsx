import { App, Notice } from "obsidian";
import * as React from "react";
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
import { SourcePatch, uniqueSourceName, validateSourceName, withSource } from "src/sync/sources";
import { ConfirmModal } from "src/ui/modals/confirmModal";
import CarddavSettings, { CarddavSettingsInterface } from "src/ui/settings/components/carddavSettings";
import { generateUUID } from "src/util/vcard";

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
      <div className="setting-item js-keep">
        <div className="setting-item-info">
          <div className="setting-item-name">Address book name</div>
          <div className="setting-item-description">
            Notes refer to this address book with <code>source: {source.name}</code>.
            {source.enabled ? <div className="mod-success">Sync enabled. {connectionLabel(saved)}.</div> : null}
            {source.enabled ? <div>Disable sync to change the connection settings.</div> : null}
            {nameError ? <div className="mod-warning">{nameError}</div> : null}
            {warning ? <div className="mod-warning">{warning}</div> : null}
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
          {source.enabled
            ? <button className="mod-destructive" onClick={() => { void disable(); }}>Disable</button>
            : <button className="mod-cta" onClick={() => { void enable(); }}>Enable</button>}
        </div>
      </div>

      <CarddavSettings
        carddavSettings={form}
        setCarddavSettings={setForm}
        savedAuthType={hasStoredCredentials(saved) ? saved.authType : undefined}
        locked={source.enabled}
        onForgetSaved={() => { void forgetSaved(); }}
      />

      <div className="setting-item">
        <div className="setting-item-info">
          <div className="setting-item-name">Default for new contacts</div>
        </div>
        <div className="setting-item-control">
          <input
            type="radio"
            name="vcf-default-source"
            aria-label={`Make ${source.name} the default address book`}
            checked={isDefault}
            onChange={() => { void attempt(onMakeDefault); }}
          />
          <button className="mod-warning" onClick={() => { void remove(); }}>Remove</button>
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
          <div className="setting-item-name">Address books</div>
          <div className="setting-item-description">Each address book is a CardDAV server. New contacts go to the default one.</div>
        </div>
        <div className="setting-item-control">
          <button className="mod-cta" onClick={() => { void attempt(add); }}>Add address book</button>
        </div>
      </div>
    </>
  );
}
