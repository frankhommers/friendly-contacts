import "src/insights/insightLoading";

import {Notice, Plugin, TAbstractFile, TFile} from 'obsidian';
import { getPluginDir, setPluginDir } from "src/context/sharedAppContext";
import { defaultSourceOf } from "src/sync/sources";
import { migrateSyncStateDir, obsidianFileStore } from "src/sync/syncState";
import { getSettings, initSettings, settings } from "src/context/sharedSettingsContext";
import { ContactsSettingTab } from 'src/ui/settings/settingsView';
import { ContactsView } from "src/ui/sidebar/sidebarView";
import { CONTACTS_VIEW_CONFIG } from "src/util/constants";
import myScrollTo from "src/util/myScrollTo";

import {updateFrontMatter} from "./contacts";
import {vcard} from "./contacts/vcard";
import { contactNotes, convertContactNotes, obsidianMirrorEnv } from "./contacts/obsidianNotes";
import { RelationMirror } from "./contacts/relationMirror";
import { isContactFrontmatter } from "./contacts/friendlyNotes";
import { isFileInFolder } from "src/file/file";
import { openImportContactModal } from "src/ui/modals/importContactModal";
import { isSyncAvailable } from "src/sync/adapters";
import { sync } from "src/sync";
import { MoveContactsModal } from "src/ui/modals/moveContactsModal";
import { CheckRelationsModal, oneSidedRelations } from "src/ui/modals/checkRelationsModal";
import { ContactsPluginSettings } from  './settings/settings.d';
import { mirrorRelationsOnThisDevice } from "src/settings/deviceSettings";

export default class ContactsPlugin extends Plugin {
	settings!: ContactsPluginSettings;

	async onload() {

		setPluginDir(this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`);
		const { migratedFrom } = await initSettings(this.loadData.bind(this), this.saveData.bind(this));
		// Every load: sync bases of the single-server days (and those of an interrupted move) go to the default source.
		const legacyTarget = migratedFrom ?? defaultSourceOf(getSettings())?.id;
		if (legacyTarget) {
			try {
				await migrateSyncStateDir(obsidianFileStore(this.app), `${getPluginDir()}/sync-state`, legacyTarget);
			} catch (error) {
				console.error('Friendly Contacts: moving the sync state failed, retrying on the next load', error);
			}
		}
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

    this.addCommand({
      id: "friendly-contacts-convert",
      name: "Convert contacts to friendly properties",
      callback: async () => {
        const { converted, moved, failed } = await convertContactNotes(this.app);
        const parts = [`Converted ${converted} contacts`];
        if (moved.length > 0) parts.push(`${moved.length} notes had conflicting values, see console`);
        if (failed > 0) parts.push(`${failed} failed, see console`);
        if (moved.length > 0) console.log("Friendly Contacts: old vCard values that differed from existing properties were moved to numbered properties or merged:\n" + moved.join("\n"));
        new Notice(parts.join("; "));
      },
    });

    this.addCommand({
      id: "friendly-contacts-move",
      name: "Move contacts to folder…",
      callback: () => {
        const folder = getSettings().contactsFolder;
        if (contactNotes(this.app, folder).length === 0) {
          new Notice("No contacts to move.");
          return;
        }
        new MoveContactsModal(this.app, () => contactNotes(this.app, folder).length, () => folder).open();
      },
    });

    this.addCommand({
      id: "friendly-contacts-import",
      name: "Import contact from server…",
      callback: async () => {
        if (!isSyncAvailable()) {
          new Notice("No address book is set up.");
          return;
        }
        await openImportContactModal(this.app);
      },
    });

    this.addCommand({
      id: "friendly-contacts-sync-contact",
      name: "Sync this contact",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const frontmatter = file ? this.app.metadataCache.getFileCache(file)?.frontmatter : undefined;
        const ok = !!file && file.extension === "md" && !!frontmatter && isContactFrontmatter(frontmatter) && isFileInFolder(file) && isSyncAvailable();
        if (!ok || checking) return ok;
        void sync.syncContact(file);
        return true;
      },
    });

    this.addCommand({
      id: "friendly-contacts-check-relations",
      name: "Check relationships",
      callback: () => {
        const items = oneSidedRelations(this.app, getSettings().friendly.mapping);
        if (items.length === 0) {
          new Notice("All relationships are two-sided.");
          return;
        }
        new CheckRelationsModal(this.app, items, () => getSettings().friendly.mapping).open();
      },
    });

    this.setupRelationMirror();
	}

	/** Mirrors relationship properties between contact notes (`children` <-> `parents`). */
	private setupRelationMirror() {
		if (!mirrorRelationsOnThisDevice(this.app)) return;
		const { metadataCache, vault } = this.app;
		const mirror = new RelationMirror(obsidianMirrorEnv(this.app), () => getSettings().friendly.mapping);
		let ready = false;
		// One queue: handlers never overlap, so snapshots and writes stay in event order.
		let queue: Promise<void> = Promise.resolve();
		const enqueue = (action: () => Promise<void> | void) => {
			// Without a contacts folder every note with a name looks like a contact: no automatic writes then.
			if (!ready || getSettings().contactsFolder === '') return;
			queue = queue.then(action).catch((error) => {
				console.error('Friendly Contacts: relationship mirroring failed', error);
				new Notice('Relationship mirroring failed; see the console.');
			});
		};
		const isContactFile = (file: TAbstractFile): file is TFile =>
			file instanceof TFile && file.extension === 'md' && isFileInFolder(file);
		// 'create' fires before the note is in the metadata cache; its first 'changed' event is the cue.
		const pendingCreated = new Set<string>();

		this.registerEvent(metadataCache.on('changed', (file, _data, cache) => {
			if (!isContactFile(file) || !cache.frontmatter || !isContactFrontmatter(cache.frontmatter)) return;
			if (pendingCreated.delete(file.path)) enqueue(() => mirror.onCreated(file.path));
			else enqueue(() => mirror.onChanged(file.path, { ...cache.frontmatter }));
		}));
		this.registerEvent(vault.on('create', (file) => {
			if (ready && isContactFile(file)) pendingCreated.add(file.path);
		}));
		this.registerEvent(vault.on('rename', (file, oldPath) => {
			const wasContact = oldPath.endsWith('.md') && oldPath.startsWith(getSettings().contactsFolder);
			if (wasContact || isContactFile(file)) {
				if (pendingCreated.delete(oldPath)) pendingCreated.add(file.path);
				enqueue(() => mirror.onRenamed(oldPath, file.path));
			}
		}));

		// The snapshots belong to the contacts folder: a Move or a changed folder setting starts over from the new one.
		let folder = getSettings().contactsFolder;
		this.register(settings.subscribe((value) => {
			if (!value || value.contactsFolder === folder) return;
			folder = value.contactsFolder;
			enqueue(() => {
				pendingCreated.clear();
				mirror.rebuild();
			});
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
