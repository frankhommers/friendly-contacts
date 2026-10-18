import { TFile } from "obsidian";
import * as React from "react";
import { Contact } from "src/contacts";
import { fileId } from "src/file/file";
import { ContactView } from "src/ui/sidebar/components/ContactView";
import { compareBirthdays } from "src/util/birthday";
import { Sort } from "src/util/constants";
import myScrollTo from "src/util/myScrollTo";
import { getSortName } from "src/util/nameUtils";


type ContactsListProps = {
	contacts: Contact[];
	sort: Sort;
	processAvatar: (contact: Contact) => void;
	exportVCF: (contactFile: TFile) => void;
};

export const ContactsListView = (props: ContactsListProps) => {
	const [processedContacts, setProcessedContacts] = React.useState<Contact[]>(
		[]
	);

	const contacts = props.contacts;
	const sort = props.sort;

	React.useEffect(() => {
		const sortedContacts = [...contacts].sort((a, b) => {
			switch (sort) {
				case Sort.NAME: {
          const nameA= getSortName(a.data);
          const nameB= getSortName(b.data);
          return nameA.localeCompare(nameB);
        }
				case Sort.BIRTHDAY:
					return compareBirthdays(a.data['BDAY'], b.data['BDAY'], new Date());
				case Sort.ORG: {
					const orgA = a.data['ORG'];
					const orgB = b.data['ORG'];

					if (orgA && !orgB) return -1;
					if (!orgA && orgB) return 1;

					if (!orgA && !orgB) {
						return 0;
					}
					return orgA.localeCompare(orgB);

				}
				default:
					return 0;
			}
		});
		setProcessedContacts(sortedContacts);
	}, [contacts, sort]);


	React.useEffect(() => {
		myScrollTo.scrollToTop()
	}, [sort]);

	return (
		<>
			{processedContacts.map((contact) => {
				return <ContactView contact={contact} key={fileId(contact.file)} exportVCF={props.exportVCF} processAvatar={props.processAvatar} />;
			})}
		</>
	);
};
