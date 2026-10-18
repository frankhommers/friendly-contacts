import { App, Notice } from "obsidian";
import * as React from "react";
import { notesNamingSource, notesUsingSource, removeSourceState, renameSourceInNotes } from "src/contacts/sourceNotes";
import { getPluginDir } from "src/context/sharedAppContext";
import { getSettings, setSettings } from "src/context/sharedSettingsContext";
import {
  connectionLabel,
  hasStoredCredentials,
  resolveCredentials,
  StoredCredentials,
  usernameFromAuthKey,
} from "src/settings/carddavCredentials";
import { ContactsPluginSettings, Source } from "src/settings/settings";
import { connectionProblem, forgetAdapter } from "src/sync/adapters";
import { removalBlocker, uniqueSourceName, validateSourceName, withoutSource, withSource } from "src/sync/sources";
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
  /** Persists a changed source. */
  onSave: (source: Source) => Promise<void>;
  onMakeDefault: () => Promise<void>;
  onRemoved: () => void;
}

function SourceBlock({ app, source, isDefault, onSave, onMakeDefault, onRemoved }: SourceBlockProps) {
  const [name, setName] = React.useState(source.name);
  const [nameError, setNameError] = React.useState('');
  const [warning, setWarning] = React.useState('');
  const [form, setForm] = React.useState<CarddavSettingsInterface>(() => formFromSource(source));
  const saved: StoredCredentials = { authType: source.authType, authKey: source.authKey };

  React.useEffect(() => { setName(source.name); }, [source.name]);

  const commitName = async () => {
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
    const count = notesNamingSource(app, source.name).length;
    // Notes first, then the setting: a note that keeps the old name would point at an unknown address book.
    const rename = async () => {
      const { renamed, failed } = await renameSourceInNotes(app, source.name, wanted);
      await onSave({ ...source, name: wanted });
      if (failed.length > 0) console.log(`Friendly Contacts: not renamed in:\n${failed.join('\n')}`);
      if (count > 0) {
        new Notice(`Renamed ${source.name} to ${wanted} in ${renamed} contact notes`
          + (failed.length > 0 ? `; ${failed.length} failed, see console` : ''));
      }
    };
    if (count === 0) {
      await rename();
      return;
    }
    new ConfirmModal(app, `Rename ${source.name} to ${wanted} in ${count} contact notes?`, 'Rename', rename, 'Cancel', () => setName(source.name)).open();
  };

  const enable = async () => {
    const resolved = resolveCredentials(form, saved);
    if (!resolved.ok) {
      setWarning(resolved.error);
      return;
    }
    const next: Source = { ...source, addressBookUrl: form.addressBookUrl, authType: resolved.authType, authKey: resolved.authKey, enabled: true };
    const problem = await connectionProblem(next);
    if (problem) {
      setWarning(problem);
      return;
    }
    setWarning('');
    setForm(formFromSource(next));
    await onSave(next);
  };

  const disable = () => onSave({ ...source, enabled: false });

  const forgetSaved = () => onSave({ ...source, authKey: '' });

  const remove = async () => {
    const { sources, defaultSource } = getSettings();
    const using = await notesUsingSource(app, source, sources, defaultSource);
    const blocker = removalBlocker(source, defaultSource, using.length);
    if (blocker) {
      new Notice(blocker);
      return;
    }
    new ConfirmModal(app, `Remove ${source.name}? Its synchronization state is deleted too.`, 'Remove', async () => {
      await setSettings(withoutSource(getSettings(), source.id));
      forgetAdapter(source.id);
      try {
        await removeSourceState(app, source.id, getPluginDir());
      } catch (error) {
        console.error(`Friendly Contacts: could not delete the sync state of ${source.name}`, error);
      }
      onRemoved();
    }).open();
  };

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
            onBlur={commitName}
          />
          {source.enabled
            ? <button className="mod-destructive" onClick={disable}>Disable</button>
            : <button className="mod-cta" onClick={enable}>Enable</button>}
        </div>
      </div>

      <CarddavSettings
        carddavSettings={form}
        setCarddavSettings={setForm}
        savedAuthType={hasStoredCredentials(saved) ? saved.authType : undefined}
        locked={source.enabled}
        onForgetSaved={forgetSaved}
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
            onChange={onMakeDefault}
          />
          <button className="mod-warning" onClick={remove}>Remove</button>
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
          onSave={(next) => save(withSource(getSettings(), next))}
          onMakeDefault={() => save({ ...getSettings(), defaultSource: source.id })}
          onRemoved={refresh}
        />
      ))}
      <div className="setting-item js-keep">
        <div className="setting-item-info">
          <div className="setting-item-name">Address books</div>
          <div className="setting-item-description">Each address book is a CardDAV server. New contacts go to the default one.</div>
        </div>
        <div className="setting-item-control">
          <button className="mod-cta" onClick={add}>Add address book</button>
        </div>
      </div>
    </>
  );
}
