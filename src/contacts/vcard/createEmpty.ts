import { friendlyKey } from "src/contacts/friendlyNotes";
import { ensureHasName } from "src/contacts/vcard/shared/ensureHasName";
import { getSettings } from "src/context/sharedSettingsContext";
import { generateUUID } from "src/util/vcard";

/** Friendly properties of a new contact: its name (asked for), the default fields empty, and a UID. */
export async function createEmpty(): Promise<Record<string, string>> {
  const { createFieldsKeys, friendly } = getSettings();

  const named = await ensureHasName({ "FN": "", "N.GN": "", "N.FN": "" });
  const firstname = named["N.GN"] ?? "";
  const lastname = named["N.FN"] ?? "";
  const props: Record<string, string> = {
    name: named["FN"] || [firstname, lastname].filter((part) => part !== "").join(" "),
    firstname,
    lastname,
  };

  for (const key of createFieldsKeys) {
    const property = friendlyKey(key, friendly.mapping);
    props[property] ??= "";
  }
  props.uid = `urn:uuid:${generateUUID()}`;
  return props;
}
