import { VCardForObsidianRecord } from "src/contacts/vcard/index";
import { VCardKinds } from "src/contacts/vcard/shared/structuredFields";
import { getApp } from "src/context/sharedAppContext";
import type { BookChoice } from "src/sync/sources";
import { ContactNameModal, NamingPayload } from "src/ui/modals/contactNameModal";
import { createNameSlug } from "src/util/nameUtils";

/** Asks for a contact's name and, given address books to choose from, the book it goes to. */
export function askContactName(books?: BookChoice): Promise<NamingPayload> {
  return new Promise((resolve) => new ContactNameModal(getApp(), resolve, books).open());
}

export async function ensureHasName(
  vCardObject: VCardForObsidianRecord
): Promise<VCardForObsidianRecord> {
  try {
    // if we can create a file name then we meet the minimum requirements
    createNameSlug(vCardObject)
    return Promise.resolve(vCardObject);
  } catch (error) {
    // Need to prompt for some form of name information.
    console.warn("No name found for record", vCardObject);
    const nameData = await askContactName();
    if(nameData.kind === VCardKinds.Individual) {
      vCardObject["N.PREFIX"] ??= "";
      vCardObject["N.GN"] = nameData.given;
      vCardObject["N.MN"] ??= "";
      vCardObject["N.FN"] = nameData.family;
      vCardObject["N.SUFFIX"] ??= "";
    } else {
      vCardObject["FN"] = nameData.fn;
    }
    vCardObject["KIND"] = nameData.kind;
    return vCardObject;
  }
}
