import { friendlyKey } from "src/contacts/friendlyNotes";
import { askContactName } from "src/contacts/vcard/shared/ensureHasName";
import { VCardKinds } from "src/contacts/vcard/shared/structuredFields";
import { getSettings } from "src/context/sharedSettingsContext";
import { bookChoice } from "src/sync/sources";
import { generateUUID } from "src/util/vcard";

/**
 * Friendly properties of a new contact: its name (asked for), the default fields empty, and a UID. With more than
 * one address book the book is asked for too (the default preselected) and written as `source`.
 */
export async function createEmpty(): Promise<Record<string, string>> {
  const settings = getSettings();
  const { createFieldsKeys, friendly } = settings;

  const named = await askContactName(bookChoice(settings));
  const firstname = named.kind === VCardKinds.Individual ? named.given : "";
  const lastname = named.kind === VCardKinds.Individual ? named.family : "";
  const props: Record<string, string> = {
    name: named.kind === VCardKinds.Individual ? [firstname, lastname].filter((part) => part !== "").join(" ") : named.fn,
    firstname,
    lastname,
  };
  if (named.source !== undefined) props.source = named.source;

  for (const key of createFieldsKeys) {
    const property = friendlyKey(key, friendly.mapping);
    props[property] ??= "";
  }
  props.uid = `urn:uuid:${generateUUID()}`;
  return props;
}
