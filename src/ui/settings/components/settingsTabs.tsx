import { App } from "obsidian";
import * as React from "react";
import { offerLayoutChange } from "src/ui/modals/layoutChangeModal";
import { GravatarSettings } from "src/ui/settings/components/gravatarSettings";
import { InsightSettings } from "src/ui/settings/components/insightsSettings";
import { LayoutSettingsSection } from "src/ui/settings/components/layoutSettings";
import { MasterSetting } from "src/ui/settings/components/masterSettings";
import { PropertyNamesSettings } from "src/ui/settings/components/propertyNamesSettings";
import { SynchronizationSettings } from "src/ui/settings/components/synchronizationSettings";

export const SETTINGS_TABS = ["General", "Sync", "Properties"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

/** The tab shown last; the settings open on it again until Obsidian restarts. */
let lastTab: SettingsTab = "General";

/** The plugin settings, split over tabs. */
export function SettingsTabs({ app }: { app: App }) {
  const [tab, setTab] = React.useState<SettingsTab>(lastTab);
  const open = (next: SettingsTab) => {
    lastTab = next;
    setTab(next);
  };
  return (
    <>
      <div className="vcf-settings-tabs" role="tablist">
        {SETTINGS_TABS.map((name) => (
          <button
            key={name}
            role="tab"
            aria-selected={tab === name}
            className={`vcf-settings-tab${tab === name ? " is-active" : ""}`}
            onClick={() => open(name)}
          >
            {name}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={tab}>
        {tab === "General" && (
          <>
            <MasterSetting app={app} />
            <LayoutSettingsSection app={app} onLayoutChanged={(_from, to) => offerLayoutChange(app, to)} />
            <GravatarSettings />
            <InsightSettings />
          </>
        )}
        {tab === "Sync" && <SynchronizationSettings app={app} />}
        {tab === "Properties" && <PropertyNamesSettings app={app} />}
      </div>
    </>
  );
}
