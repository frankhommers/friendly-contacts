import "src/insights/insightLoading";

import {Notice, Plugin, TAbstractFile, TFile} from 'obsidian';
import { setPluginDir } from "src/context/sharedAppContext";
import { getSettings, initSettings } from "src/context/sharedSettingsContext";
import { ContactsSettingTab } from 'src/ui/settings/settingsView';
import { ContactsView } from "src/ui/sidebar/sidebarView";
import { CONTACTS_VIEW_CONFIG } from "src/util/constants";
import myScrollTo from "src/util/myScrollTo";

import {updateFrontMatter} from "./contacts";
import {vcard} from "./contacts/vcard";
import { obsidianMirrorEnv } from "./contacts/obsidianNotes";
import { RelationMirror } from "./contacts/relationMirror";
import { isContactFrontmatter } from "./contacts/friendlyNotes";
import { isFileInFolder } from "src/file/file";
import { ContactsPluginSettings } from  './settings/settings.d';

export default class ContactsPlugin extends Plugin {
	settings!: ContactsPluginSettings;

	async onload() {

		setPluginDir(this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`);
		await initSettings(this.loadData.bind(this), this.saveData.bind(this));
		this.registerView(
			CONTACTS_VIEW_CONFIG.type,
			(leaf) => new ContactsView(leaf, this)
		);

		this.addRibbonIcon('contact', 'Contacts', () => {
			this.activateSidebarView();
      myScrollTo.handleLeafEvent(null);
		});

		this.addSettingTab(new ContactsSettingTab(this.app, this));

    this.addCommand({
      id: 'contacts-sidebar',
      name: "Open Contacts Sidebar",
      callback: () => {
        this.activateSidebarView();
      },
    });

    this.addCommand({
      id: 'contacts-create',
      name: "Create Contact",
      callback: async () => {
        const leaf = await this.activateSidebarView();
        leaf?.createNewContact()
      },
    });

    this.addCommand({
      id: "contacts-apply-default-fields",
      name: "Apply Default Fields to Current File",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (!file) {
          new Notice("No active file.");
          return;
        }
        const records = await vcard.addDefaultFields(file);
        updateFrontMatter(file, records)
      }
    });

    this.setupRelationMirror();
	}

	/** Mirrors relationship properties between contact notes (`children` <-> `parents`). */
	private setupRelationMirror() {
		const settings = getSettings();
		if (!settings.friendly.mirrorRelations) return;
		const { metadataCache, vault } = this.app;
		const mirror = new RelationMirror(obsidianMirrorEnv(this.app), () => getSettings().friendly.mapping);
		let ready = false;
		const guard = (action: () => Promise<void> | void) => {
			if (!ready) return;
			Promise.resolve()
				.then(action)
				.catch((error) => {
					console.error('Friendly Contacts: relationship mirroring failed', error);
					new Notice('Relationship mirroring failed; see the console.');
				});
		};
		const isContactFile = (file: TAbstractFile): file is TFile =>
			file instanceof TFile && file.extension === 'md' && isFileInFolder(file);

		this.registerEvent(metadataCache.on('changed', (file, _data, cache) => {
			if (!isContactFile(file) || !cache.frontmatter || !isContactFrontmatter(cache.frontmatter)) return;
			guard(() => mirror.onChanged(file.path, { ...cache.frontmatter }));
		}));
		this.registerEvent(vault.on('create', (file) => {
			if (isContactFile(file)) guard(() => mirror.onCreated(file.path));
		}));
		this.registerEvent(vault.on('rename', (file, oldPath) => {
			if (isContactFile(file)) guard(() => mirror.onRenamed(oldPath, file.path));
		}));

		const start = () => {
			if (ready) return;
			mirror.init();
			ready = true;
		};
		// `resolved` is true once the initial indexing is done; it is missing from the typings.
		if ((metadataCache as unknown as { resolved?: boolean }).resolved) start();
		else {
			const ref = metadataCache.on('resolved', () => {
				metadataCache.offref(ref);
				start();
			});
			this.registerEvent(ref);
		}
	}

	onunload() {}


	async activateSidebarView() {
		if (this.app.workspace.getLeavesOfType(CONTACTS_VIEW_CONFIG.type).length < 1) {
      const leaf = this.app.workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({
          type: CONTACTS_VIEW_CONFIG.type,
          active: true,
        });
      }
		}

    // Grab the leaf
    const leaf = this.app.workspace.getLeavesOfType(CONTACTS_VIEW_CONFIG.type)[0];
    if (!leaf) return null;

    await this.app.workspace.revealLeaf(leaf);
    return leaf.view as ContactsView;
	}
}
