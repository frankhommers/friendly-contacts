import { DEFAULT_MAPPING } from "src/contacts/friendly/mapping";
import { ContactsPluginSettings } from "src/settings/settings";

/** Upstream's default contact fields; a stored list equal to this is replaced by the friendly default. */
export const LEGACY_CREATE_FIELDS_KEYS: readonly string[] = [
  "N.PREFIX",
  "N.GN",
  "N.MN",
  "N.FN",
  "N.SUFFIX",
  "TEL[CELL]",
  "TEL[HOME]",
  "TEL[WORK]",
  "EMAIL[HOME]",
  "EMAIL[WORK]",
  "BDAY",
  "PHOTO",
  "ADR[HOME].STREET",
  "ADR[HOME].LOCALITY",
  "ADR[HOME].POSTAL",
  "ADR[HOME].COUNTRY",
  "URL[WORK]",
  "ORG",
  "ROLE",
  "CATEGORIES"
];

export const DEFAULT_SETTINGS: ContactsPluginSettings = {
  contactsFolder: '',
  defaultHashtag: '',
  processors: {},
  groupInsights: true,
  sources: [],
  defaultSource: '',
  createFieldsKeys: [
    'firstname', 'lastname', 'mobile', 'phone', 'work-phone', 'email', 'work-email', 'birthday',
    'street', 'city', 'postcode', 'country', 'website', 'company', 'title', 'categories',
  ],
  friendly: {
    mapping: DEFAULT_MAPPING
  }
}
