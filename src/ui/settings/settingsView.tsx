import { App, PluginSettingTab } from "obsidian";
import * as React from "react";
import { createRoot, Root } from "react-dom/client";
import ContactsPlugin from "src/main";
import { CardFieldSettings } from "src/ui/settings/components/cardFieldSettings";
import { InsightSettings } from "src/ui/settings/components/insightsSettings";
import { offerLayoutChange } from "src/ui/modals/layoutChangeModal";
import { LayoutSettingsSection } from "src/ui/settings/components/layoutSettings";
import { MasterSetting } from "src/ui/settings/components/masterSettings";
import { PropertyNamesSettings } from "src/ui/settings/components/propertyNamesSettings";
import { SynchronizationSettings } from "src/ui/settings/components/synchronizationSettings";

export class ContactsSettingTab extends PluginSettingTab {
  plugin: ContactsPlugin;
  app: App;
  root: Root | null = null;

  constructor(app: App, plugin: ContactsPlugin) {
    super(app, plugin);
    this.app = app;
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.root = createRoot(containerEl);
    this.root.render(
      <>
        <MasterSetting
          app={this.app}
        />
        <LayoutSettingsSection app={this.app} onLayoutChanged={(_from, to) => offerLayoutChange(this.app, to)} />
        <CardFieldSettings />
        <PropertyNamesSettings app={this.app} />
        <InsightSettings />
        <SynchronizationSettings app={this.app} />
      </>
    );
  }

  hide(): void {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
  }

}
