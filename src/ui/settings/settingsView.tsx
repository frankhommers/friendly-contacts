import { App, PluginSettingTab } from "obsidian";
import * as React from "react";
import { createRoot, Root } from "react-dom/client";
import ContactsPlugin from "src/main";
import { SettingsTabs } from "src/ui/settings/components/settingsTabs";

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
    this.root.render(<SettingsTabs app={this.app} />);
  }

  hide(): void {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
  }

}
