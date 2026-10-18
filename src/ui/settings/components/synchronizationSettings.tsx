import {Platform} from "obsidian";
import * as React from "react";
import {useState} from "react";
import {getSettings, setSettings} from "src/context/sharedSettingsContext";
import {
  hasStoredCredentials,
  resolveCredentials,
  StoredCredentials,
  usernameFromAuthKey
} from "src/settings/carddavCredentials";
import {ContactsPluginSettings, Source} from "src/settings/settings";
import {carddavAdapter} from "src/sync/adapters/carddavGeneric";
import {defaultSourceOf, sourceNameFromUrl} from "src/sync/sources";
import {generateUUID} from "src/util/vcard";
import CarddavSettings, {CarddavSettingsInterface} from "src/ui/settings/components/carddavSettings";

/**
 * Secrets are never shown again. The username is recovered from the saved
 * basic auth key so the form reflects what is configured.
 */
function formFromSaved(addressBookUrl: string, saved: StoredCredentials): CarddavSettingsInterface {
  return {
    addressBookUrl,
    username: saved.authType === 'basic' ? usernameFromAuthKey(saved.authKey) : '',
    password: '',
    apiKey: ''
  };
}

type SyncSelected = 'None' | 'CardDAV';

/** Settings with `source` as the default source (added when there was none), or with it replaced. */
function withDefaultSource(settings: ContactsPluginSettings, source: Source): ContactsPluginSettings {
  const exists = settings.sources.some((s) => s.id === source.id);
  return {
    ...settings,
    sources: exists ? settings.sources.map((s) => (s.id === source.id ? source : s)) : [...settings.sources, source],
    defaultSource: exists ? settings.defaultSource : source.id,
  };
}

export function SynchronizationSettings() {
  const isDisabled = Platform.isMobileApp;
  const [warning, setWarning] = useState('');
  const initSettings = getSettings();
  const initSource = defaultSourceOf(initSettings);
  const [syncEnabled, setSyncEnabled] = useState<boolean>(initSource?.enabled === true);
  const [syncSelected, setSyncSelected] = useState<SyncSelected>(initSource ? 'CardDAV' : 'None');
  const [savedCredentials, setSavedCredentials] = useState<StoredCredentials>({
    authType: initSource?.authType ?? 'apikey',
    authKey: initSource?.authKey ?? ''
  });
  const [carddavSettings, setCarddavSettings] = useState<CarddavSettingsInterface>(
    formFromSaved(initSource?.addressBookUrl ?? '', savedCredentials)
  );

  const enableSync = async () => {
    if (syncSelected !== 'CardDAV') {
      setWarning('Kindly select a synchronization method and provide the required connection information. Thank you!');
      return;
    }

    const resolved = resolveCredentials(carddavSettings, savedCredentials);
    if (!resolved.ok) {
      setWarning(resolved.error);
      return;
    }
    const credentials: StoredCredentials = { authType: resolved.authType, authKey: resolved.authKey };

    try {
      const result = await carddavAdapter({ addressBookUrl: carddavSettings.addressBookUrl, ...credentials }).checkConnectivity();
      if (result.errorMessage) {
        setWarning(`failed to enable connection! ${result.errorMessage}. Please check your connection settings.`);
        return;
      }
      if (!(result.status >= 200 && result.status < 300)) {
        setWarning('failed to enable connection! unknown error. Please check your connection settings.');
        return;
      }

      const current = getSettings();
      const existing = defaultSourceOf(current);
      const source: Source = {
        id: existing?.id ?? generateUUID(),
        name: existing?.name ?? sourceNameFromUrl(carddavSettings.addressBookUrl),
        addressBookUrl: carddavSettings.addressBookUrl,
        enabled: true,
        ...credentials
      };
      setSavedCredentials(credentials);
      setCarddavSettings(formFromSaved(carddavSettings.addressBookUrl, credentials));
      setSyncEnabled(true);
      setWarning('');
      await setSettings(withDefaultSource(current, source));
    } catch (err: any) {
      setWarning(`failed to enable connection! ${err?.message || err || 'Unknown error'}.`);
    }
  };

  const forgetSaved = async () => {
    setSavedCredentials({ ...savedCredentials, authKey: '' });
    const current = getSettings();
    const source = defaultSourceOf(current);
    if (source) await setSettings(withDefaultSource(current, { ...source, authKey: '' }));
  };

  const connectedAs = savedCredentials.authType === 'apikey'
    ? 'Connected with API key'
    : `Connected as ${usernameFromAuthKey(savedCredentials.authKey) || 'anonymous'}`;

  const disableSync = async () => {
    setSyncEnabled(false);
    setSyncSelected('None');
    const current = getSettings();
    const source = defaultSourceOf(current);
    if (source?.enabled) await setSettings(withDefaultSource(current, { ...source, enabled: false }));
  }

  // On mobile the address books are unavailable at runtime (activeSources() is empty); the saved settings stay.

  return (
    <>
      <div className="setting-item setting-item-heading">
        <div className="setting-item-info">
          <div className="setting-item-name">Contacts server synchronization settings</div>
          <div className="setting-item-description"></div>
        </div>
        <div className="setting-item-control"></div>
      </div>

      {isDisabled ? (
        <div className="callout" data-callout="info">
          <div className="callout-title">
            <div className="callout-title-inner">Contacts synchronization on mobile</div>
          </div>
          <div className="callout-content">
            <p>
              The mobile version of the VCF Contacts plugin can display and edit your contact files,
              but it can’t connect directly to contact servers like carddav, microsoft exchange, ldap or your adroid, ios contacts app.
            </p>
            <p>
              Obsidian Sync (or another vault sync tool) keeps your contact files aligned with the desktop devices.
              For synchronization with contact servers or your mobile device contacts, use the desktop version.
              You can read more in the project’s README file.
            </p>
          </div>
        </div>
      ) : (
        <>
          {!syncEnabled ? (
            <div className="callout" data-callout="warning">
              <div className="callout-title">
                <div className="callout-title-inner">Use synchronization carefully</div>
              </div>
              <div className="callout-content">
                <p>
                  Before enabling contact server sync, ensure you have a recent backup.
                  These features are best suited for users who have some technical experiance.
                </p>
              </div>
            </div>
          ) : null}
          <div className="setting-item js-keep">
            <div className="setting-item-info">
              <div className="setting-item-name">Synchronization</div>
              <div className="setting-item-description">
                {syncEnabled ? <div className="mod-success">CardDAV sync enabled. {connectedAs}.</div> : ''}
                {syncEnabled ? <div>Disable sync to change the connection settings.</div> : ''}
                <div className="mod-warning">{warning}</div>
              </div>
            </div>
            <div className="setting-item-control">
              {syncEnabled ?
                <button className="mod-destructive" onClick={disableSync}>Disable</button>
                :
                <button className="mod-cta" onClick={enableSync}>Enable</button>
              }
            </div>
          </div>
          <div className="setting-item js-keep">
            <div className="setting-item-info">
              <div className="setting-item-name">Sync method</div>
              <div className="setting-item-description">Choose how you want to synchronize your contacts.</div>
            </div>
            <div className="setting-item-control">
              <select
                className="dropdown"
                value={syncSelected}
                onChange={e => {
                  disableSync();
                  setSyncSelected(e.target.value as SyncSelected);
                }}>
                <option value="None">No synchronization</option>
                <option value="CardDAV">CardDAV address book</option>
              </select>
            </div>
          </div>

          {syncSelected === "CardDAV" && (
            <CarddavSettings
              carddavSettings={carddavSettings}
              setCarddavSettings={setCarddavSettings}
              savedAuthType={hasStoredCredentials(savedCredentials) ? savedCredentials.authType : undefined}
              locked={syncEnabled}
              onForgetSaved={forgetSaved}
            />
          )}
        </>
      )}
    </>
  )

}
