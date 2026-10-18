import {App, Platform} from "obsidian";
import * as React from "react";
import {SourcesSettings} from "src/ui/settings/components/sourcesSettings";

export function SynchronizationSettings({app}: {app: App}) {
  const isDisabled = Platform.isMobileApp;
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
          <SourcesSettings app={app} />
        </>
      )}
    </>
  )

}
