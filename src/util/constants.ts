export const CONTACTS_VIEW_CONFIG = {
	// Not upstream's "contacts-view": both plugins can be enabled side by side.
	type: "friendly-contacts-view",
	name: "Contacts",
	icon: "contact",
};

export const PEOPLE_GRAPH_VIEW = {
	type: "friendly-contacts-people-graph",
	name: "People graph",
	icon: "network",
};

export const SYNC_ALL_VIEW = {
	type: "friendly-contacts-sync-all",
	name: "Sync all contacts",
	icon: "refresh-cw",
};

export enum Sort {
	NAME,
	BIRTHDAY,
	ORG
}
