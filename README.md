

<div align="center">

<!-- TOC --><a name="-friendly-contacts-plugin-for-obsidian"></a>
# Friendly Contacts Plugin for Obsidian  
**Bring people into your knowledge vault.**  


A powerful way to manage, link, and export contact data directly within [Obsidian](https://obsidian.md).

![Friendly Contacts Plugin Interface](assets/vfz-contacts-overview.jpg)

</div>

---

## About this fork

Friendly Contacts is a fork of [VCF Contacts](https://github.com/broekema41/obsidian-vcf-contacts) by Roland Broekema. It shows contact properties with readable English names, syncs with CardDAV without losing data, and supports relationships between contacts. Its settings are separate from the original VCF Contacts plugin, so to migrate, copy `data.json` from `.obsidian/plugins/vcf-contacts/` to `.obsidian/plugins/friendly-contacts/`.

---

## Install with BRAT

To try the test releases:

1. Back up your vault first, at least `.obsidian/plugins/friendly-contacts/data.json`.
2. Install the **BRAT** plugin from Community Plugins and enable it.
3. Open the command palette and run **BRAT: Add a beta plugin for testing**.
4. Enter `frankhommers/friendly-contacts` and confirm.
5. Enable **Friendly Contacts** under **Settings → Community plugins**.

---

<!-- TOC start -->
# Table of Contents
- [Friendly Contacts Plugin for Obsidian  ](#-friendly-contacts-plugin-for-obsidian)
   * [🚀 Features at a Glance](#-features-at-a-glance)
   * [📦 Installation](#-installation)
      + [🔄 Automatic via Community Plugins](#-automatic-via-community-plugins)
      + [🧰 Manual Installation](#-manual-installation)
   * [🛠️ Getting Started](#-getting-started)
      + [📁 Set Your Contacts Folder](#-set-your-contacts-folder)
      + [📥 Importing vCards (.vcf)](#-importing-vcards-vcf)
      + [📤 Exporting Contacts to vCard](#-exporting-contacts-to-vcard)
      + [🖼️ Adding Avatars](#-adding-avatars)
      + [📞 Quick Actions](#-quick-actions)
      + [➕ Create a New Contact](#-create-a-new-contact)
      + [📂 A folder per contact](#-a-folder-per-contact)
      + [🔎 Searching Contacts (Fast!)](#-searching-contacts-fast)
   * [📖 Understanding the vCard (VCF) Format](#-understanding-the-vcard-vcf-format)
   * [📄 Example Contact Note (Foo Bar)](#-example-contact-note-foo-bar)
   * [📌 Supported vCard Fields](#-supported-vcard-fields)
      + [📞 Basic Contact Information](#-basic-contact-information)
      + [🏠 Address Fields](#-address-fields)
      + [🌐 Online Presence](#-online-presence)
      + [🖼️ Profile Photo](#-profile-photo)
      + [🗂️ Categorization & Metadata](#-categorization-metadata)
   * [🚀 Why This Format? Why a Plugin for Obsidian?](#-why-this-format-why-a-plugin-for-obsidian)
   * [🙏 Acknowledgements](#-acknowledgements)

<!-- TOC end -->

<br>
<br>

<!-- TOC --><a name="-features-at-a-glance"></a>
## 🚀 Features at a Glance

- **Organized Contact Notes** – Every contact is a markdown file, enriched with vCard-compliant frontmatter.
- **Smart Search & Linking** – Easily find, navigate, and link to contacts from any note.
- **vCard 4.0 Support** – Import/export full contact data to/from `.vcf` files.
- **Avatars Support** – Add profile pictures from local files or URLs.
- **Birthday Reminders** – Keep track of important dates.
- **Click-to-Call & Quick Copy** – Instantly act on phone numbers, emails, and more.
- **Minimal, Markdown-native UI** – It's just markdown—but smarter.

---

<!-- TOC --><a name="-installation"></a>
## 📦 Installation

<!-- TOC --><a name="-automatic-via-community-plugins"></a>
### 🔄 Automatic via Community Plugins

Friendly Contacts is not in the Community Plugins list (searching there finds the original VCF Contacts).
Install it manually, see below.

<!-- TOC --><a name="-manual-installation"></a>
### 🧰 Manual Installation


1. Download `main.js`, `manifest.json`, and `styles.css` from the GitHub Releases page.
2. Create the plugin folder in your vault:
   <VaultFolder>```/.obsidian/plugins/friendly-contacts```
3. Move the downloaded files into this folder.
4. Restart Obsidian and enable the plugin from ```Settings → Community Plugins```.

---

<!-- TOC --><a name="-getting-started"></a>
## 🛠️ Getting Started

<!-- TOC --><a name="-set-your-contacts-folder"></a>
### 📁 Set Your Contacts Folder

1. Go to **Settings → Contacts**
2. Set your **Contacts Folder Location** to any existing folder in your vault
3. You’re ready to start importing or creating contact notes!

---

<!-- TOC --><a name="-importing-vcards-vcf"></a>
### 📥 Importing vCards (.vcf)

1. Open the **Contacts** sidebar tab
2. Click **Import VCF**
3. Choose a `.vcf` file (single contact or full database)
4. If needed, you'll be prompted to fill in:
   - `Given Name` (First Name)
   - `Family Name` (Last Name)

> These are required to identify and name contact files properly.

---

<!-- TOC --><a name="-exporting-contacts-to-vcard"></a>
### 📤 Exporting Contacts to vCard

1. Select a contact or open the plugin interface
2. Click **Export VCF**
3. Choose a location to save the `.vcf` file (vCard 4.0 format)

---

<!-- TOC --><a name="-adding-avatars"></a>
### 🖼️ Adding Avatars

You can attach profile pictures using:

- 🖼️ **Local File**:  
  Click **Process Avatar**, choose an image (`.jpg`, `.png`, etc.)

- 🌐 **Image URL**:  
  Paste a URL in the `PHOTO:` field and click **Process Avatar**

> The avatar will be scaled and stored inside Obsidian's vault-local storage.

---

<!-- TOC --><a name="-quick-actions"></a>
### 📞 Actions available on the card

![VCF Contacts card actions](assets/card-functionality.png)

1. **left-click** Open contact markdown note
2. **Click to Call**: Phone numbers auto-open your default dialer
3. **Click to Email**: Launches your email client
4. **Right-click** any contact property → **Copy to Clipboard**
5. **Right-click** Open Social Links
6. **left-click** contact server sync when active
7. **left-click** export as .vcf file
8. **left-click** process and import avatar from image file

---

### ⚡ Quick Actions

The plugin provides command-based quick actions that can be accessed through Obsidian’s Command Palette.

Open the Command Palette with:

- **Ctrl + P** (Windows/Linux)
- **Cmd + P** (macOS)

Search for **“Friendly Contacts”** to see all available commands.

1) **Friendly Contacts: Create Contact**  
Create a new contact using your configured default fields.

2) **Friendly Contacts: Open Contacts Sidebar**  
Open the contacts sidebar view.

3) **Friendly Contacts: Apply Default Fields to Current File**  
Adds any missing default fields (as defined in **Settings → Default Contact Fields**) to the currently open contact file.  
Existing fields are not overwritten.

---

<!-- TOC --><a name="-create-a-new-contact"></a>
### ➕ Create a New Contact

1. Click **Create Contact**
2. Fill in:
   - `Given Name`
   - `Family Name`
3. Add any extra details:
   - Phone numbers, emails, websites, etc.
4. Your contact is now saved as a markdown file and export-ready!

> Supports all vCard 4.0-compatible fields. Feel free to link, tag, or extend notes as needed!

---

<!-- TOC --><a name="-a-folder-per-contact"></a>
### 📂 A folder per contact

By default every contact is one note. If you also keep other things about a person, such as a poem you wrote for them, a speech or their photos, you can give each contact a folder of its own. The contact's note is the **folder note**: the note that stands for the folder. Everything else sits in that folder next to it.

With **Folder per contact** and the default settings, Jan de Vries looks like this:

```
Contacts/
  Jan de Vries/
    Jan de Vries.md      <- the contact note (the folder note)
    poem for Jan.md
    holiday.jpg
```

**Settings → Contact layout**

- **Layout**: *One note per contact* or *Folder per contact*. New contacts follow this. Existing contacts stay where they are until you move them (see the commands below). When you change the layout and there are contacts to move, the plugin asks whether to do it now ("Put N contacts in their own folder?" or "Take N contacts out of their folders?"). You can say **Not now** and use the command later.
- **Folder note name**: the file name of the folder note, without `.md`. `{{name}}` stands for the contact's name, so the default `{{name}}` gives `Jan de Vries/Jan de Vries.md`. You can also type a fixed name such as `index`, then every contact's note is called `index.md` (`Jan de Vries/index.md`) and the folder carries the name. A name that cannot work (empty, ending in `.md`, a character that is not allowed in file names, any `{{...}}` other than `{{name}}`) is shown with the reason and is not saved until you fix it. While the folder settings are not usable, the plugin works as one note per contact and shows a notice that says why.
- **Fixed-name hint**: with a fixed name, the settings page adds "Obsidian's graph and tabs will show every contact as "index"." Obsidian shows file names there, and they are all the same. (Links to the contact get the contact's name as a label, see below.)
- **Folder note location**: *Inside the folder* (`Contacts/Jan de Vries/Jan de Vries.md`) or *Next to the folder* (the note is beside its folder: `Contacts/Jan de Vries.md` and `Contacts/Jan de Vries/`). *Next to the folder* needs `{{name}}` in the folder note name, otherwise every contact would get the same file name.
- **Copy from Folder Notes**: when the Folder Notes plugin is installed, this button copies its folder note name (its `{{folder_name}}` becomes `{{name}}`) and location, so the two plugins agree. If Folder Notes is set up differently from this plugin, the settings page says "Folder Notes uses different settings." Copying is refused, with a notice that says why, when Folder Notes uses something that cannot be copied: a folder note type other than `.md`, or folder notes stored in the vault folder.

**Creating a contact**

A new contact is created in the contacts folder, or in the folder of the note you have open when that is inside the contacts folder. In folder layout it is never created inside another contact's folder: then it goes next to that folder. If the contact's folder already holds a contact (for example an `index.md` from before you changed the folder note name), the plugin asks before creating the note there anyway.

**Switching existing contacts: two commands**

- **Put each contact in its own folder** creates a folder for every contact note in the contacts folder and moves the note into it, using the settings above. Set the layout to *Folder per contact* first. Links to the notes keep working, because the notes are moved through Obsidian.
- **Take contacts out of their folders** moves each contact note out of its folder, next to where the folder was, named after the contact (`Jan de Vries.md`). The folder is removed only when nothing else is left in it. A folder that still holds a poem or a photo stays, with those files in it, and only the note leaves.

Both commands only touch contact notes in the contacts folder. They never move or delete your other files, never overwrite anything (a contact whose target folder or note exists already is skipped), never delete a folder that is not empty, and never move the contacts folder itself. Contacts that are already in the wanted layout, and notes inside another contact's folder, are left alone. When it is done a notice says how many were moved and skipped and how many folders were kept because other files are in them; the details (which note, why) are in the developer console. Running a command again is safe.

**Renaming a contact**

You rename a contact through Sync, like before: change the name in the note and run **Sync this contact**. When the note is in its own folder, the review screen offers **Rename folder and note to <new name>** (ticked); otherwise it offers **Rename note to <new name>**. Whatever else is in the folder, such as the poem, moves along with the folder. With a fixed note name only the folder is renamed, the note stays `index.md`. Untick the box to keep the names.

The rename is blocked, and the box is disabled with the reason below it, when a folder or note with the new name already exists, or when the contact's folder holds other contacts (then it is a category rather than this person's folder: rename it by hand). Nothing is ever overwritten.

**Moving the contacts folder**

**Move contacts to folder…** works as before, and in folder layout a contact moves together with its whole folder and everything in it. With *Next to the folder* the folder and its note move together. A contact whose target already exists is skipped, never merged, and you cannot move contacts into a contact's own folder. If a move fails half way, what already moved is put back; if that is not possible the console says which files are now apart.

**Links when the folder note has a fixed name**

A link to `index` says nothing about whom it is, so with a fixed note name the plugin writes relationship links with the contact's name as the label, for example `[[Contacts/Jan de Vries/index|Jan de Vries]]`. The contact's name is then taken from the folder's name. When you import a contact from the address book, relationships in other notes that pointed to nobody but name this contact become links to the new note (a label you wrote yourself is kept). This only happens with a fixed note name.

---

<!-- TOC --><a name="-searching-contacts-fast"></a>
### 🔎 Searching Contacts (Fast!)

Use Obsidian's **Quick Switcher**:

- Press `Ctrl + O` (Windows/Linux) or `Cmd + O` (Mac)
- Type part of the contact’s name
- Select and hit **Enter** — the contact opens instantly

> The plugin will scroll to the selected contact card in the sidebar.

---

<!-- TOC --><a name="-understanding-the-vcard-vcf-format"></a>
## 📖 Understanding the vCard (VCF) Format

The **vCard format** (`.vcf`) is the international standard for storing and sharing contact details in a structured, machine-readable format.

It supports a wide range of information, including:

- 🧑‍💼 **Names and nicknames**
- 📱 **Phone numbers**
- ✉️ **Email addresses**
- 🏡 **Addresses**
- 🌐 **Websites and social links**
- 🖼️ **Profile photos**
- 🎂 **Birthdays and anniversaries**
- 🏷️ **Tags and categories**
- 🔒 **Privacy metadata and revision history**

Using this format ensures your contacts are **portable**, **interoperable**, and **future-proof**.. Whether you're syncing across devices or backing up your data.

> ✅ The VCF Contacts plugin uses **vCard 4.0**, the latest version of the specification.

📜 **Read the official vCard 4.0 spec**:  
[RFC 6350 – vCard MIME Directory Profile](https://datatracker.ietf.org/doc/html/rfc6350)


---

<!-- TOC --><a name="-example-contact-note-foo-bar"></a>
## 📄 Example Contact Note (Foo Bar)

Below is a sample contact note for **Ethan Hunt**, showcasing real-world-style fields supported by the plugin and the vCard 4.0 format:

![Foo Bar Card Example](assets/foo-bar-contact-card-example.jpg)

```markdown
---
N.FN: Hunt
N.GN: Ethan
FN: Ethan Hunt
PHOTO: https://raw.githubusercontent.com/broekema41/obsidian-vcf-contacts/refs/heads/master/assets/demo-data/avatars/avatar10.jpg
"EMAIL[HOME]": ethan.hunt@imf.gov
"EMAIL[WORK]": mission.control@imf.gov
"TEL[CELL]": "+13035551234"
"TEL[SECURE]": "+13035551235"
"TEL[CANADA]": "+14165551234"
BDAY: 1964-07-03
"URL[HOME]": https://imf.gov/agents/hunt
"URL[WORK]": https://phoenix.imf.gov/ethan
ORG: Impossible Missions
"ADR[HOME].STREET": 221B Spyglass Lane
"ADR[HOME].LOCALITY": Unknown
"ADR[HOME].POSTAL": "00000"
"ADR[HOME].COUNTRY": USA
CATEGORIES: Spy, Agent, Action
UID: urn:uuid:019730a76c0df-4fa2-b0cf-8078e4717c93
VERSION: "4.0"

---
#### Notes

#Contact #Spy #Agent #Action
```

---

<!-- TOC --><a name="-supported-vcard-fields"></a>
## 📌 Supported vCard Fields

Here’s a breakdown of supported vCard fields and their **human-readable meanings** — tailored for clarity and real-world use.

<!-- TOC --><a name="-basic-contact-information"></a>
### 📞 Basic Contact Information

| **vCard Field**     | **Readable Name**              | **Example**                 |
|---------------------|-------------------------------|-----------------------------|
| `VERSION`           | vCard Version                  | `4.0`                       |
| `N.PREFIX`          | Name Prefix (e.g., Mr., Dr.)   | `Dr.`                       |
| `N.GN`              | Given Name (First Name)        | `Foo`                       |
| `N.MN`              | Middle Name                    | `Middleton`                |
| `N.FN`              | Family Name (Last Name)        | `Bar`                       |
| `N.SUFFIX`          | Name Suffix (e.g., Jr., III)   | `Jr.`                       |
| `FN`                | Full Name                      | `Foo Bar`                   |
| `NICKNAME`          | Nickname                       | `Foobar`                    |
| `EMAIL[HOME]`       | Personal Email                 | `foo.bar@example.com`       |
| `EMAIL[WORK]`       | Work Email                     | `foo.bar@corporate.fake`    |
| `TEL[CELL]`         | Mobile Phone                   | `+1234567890`               |
| `TEL[HOME]`         | Home Phone                     | `+1987654321`               |
| `TEL[WORK]`         | Work Phone                     | `+1098765432`               |
| `BDAY`              | Birthday (YYYY-MM-DD)          | `1985-12-31`                |
| `GENDER`            | Gender                         | `M`, `F`, `X`               |
| `ORG`               | Organization Name              | `FakeCorp Inc.`             |
| `TITLE`             | Job Title                      | `Senior Developer`          |
| `ROLE`              | Job Role                       | `Software Engineer`         |

Dates without a year, such as a birthday or anniversary where the year is unknown, are written `--MM-DD` (for example `--03-15`). Keep the `birthday` and `anniversary` properties as Text properties in Obsidian; the Date type rejects that form.

---

<!-- TOC --><a name="-address-fields"></a>
### 🏠 Address Fields

| **vCard Field**         | **Readable Name**             | **Example**                  |
|-------------------------|-------------------------------|------------------------------|
| `ADR[HOME].STREET`      | Home Street Address           | `123 Fake Street`            |
| `ADR[HOME].LOCALITY`    | Home City                     | `Faketown`                   |
| `ADR[HOME].REGION`      | Home State/Province           | `FakeState`                  |
| `ADR[HOME].POSTAL`      | Home Postal Code              | `00000`                      |
| `ADR[HOME].COUNTRY`     | Home Country                  | `Nowhere Land`               |
| `ADR[WORK].STREET`      | Work Street Address           | `789 Corporate Ave`          |
| `ADR[WORK].LOCALITY`    | Work City                     | `Business City`              |
| `ADR[WORK].REGION`      | Work State/Province           | `IndustryState`              |
| `ADR[WORK].POSTAL`      | Work Postal Code              | `99999`                      |
| `ADR[WORK].COUNTRY`     | Work Country                  | `Enterprise Land`            |

---

<!-- TOC --><a name="-online-presence"></a>
### 🌐 Online Presence

| **vCard Field**              | **Readable Name**     | **Example**                            |
|------------------------------|------------------------|----------------------------------------|
| `URL[HOME]`                  | Personal Website       | `https://foobar.example.com`           |
| `URL[WORK]`                  | Work Website           | `https://company.fake/foobar`          |
| `SOCIALPROFILE[facebook]`   | Facebook Profile       | `https://facebook.com/foobar`          |
| `SOCIALPROFILE[twitter]`    | Twitter Profile        | `https://twitter.com/foobar`           |
| `SOCIALPROFILE[linkedin]`   | LinkedIn Profile       | `https://linkedin.com/in/foobar`       |

---

<!-- TOC --><a name="-profile-photo"></a>
### 🖼️ Profile Photo

Photo's avatars can also be imported from file and will be resized so that they become a integrated part of the contact markdown file by default. 

💡 Heads-up: The PHOTO field is a bit of a troublemaker when it comes to sync, tools, app interoperability. if there is a avatar loaded into obsidian we will not overwrite it with external data.

| **vCard Field**  | **Readable Name**      | **Example**                                |
|------------------|------------------------|--------------------------------------------|
| `PHOTO`          | Profile Picture URL    | `https://example.com/photos/foo-bar.jpg`   |

---

<!-- TOC --><a name="-categorization-metadata"></a>
### 🗂️ Categorization & Metadata

| **vCard Field** | **Readable Name**                            | **Example**                        |
|-----------------|----------------------------------------------|------------------------------------|
| `CATEGORIES`    | Tags / Categories                            | `Work, Friends`                    |
| `CLASS`         | Privacy Classification                       | `public`, `private`                |
| `KIND`          | individual, group, organization or location | `public`, `private`                |
| `REV`           | Last Updated Timestamp                       | `20240312T123456Z` (ISO 8601)      |
| `SOURCE`        | vCard Source Link                            | `https://example.com/foo-bar.vcf`  |
| `UID`           | Unique Contact ID                            | `foo-bar-uuid-1234`                |

---

<!-- TOC --><a name="-why-this-format-why-a-plugin-for-obsidian"></a>
## 🚀 Why This Format? Why a Plugin for Obsidian?

For many of us, using Obsidian is like brewing that perfect cup of coffee — energizing, efficient, and deeply satisfying. But let’s face it: managing contacts has always been a hassle.

This plugin solves that beautifully. ✨

✔ **vCard 4.0 keeps contacts tidy, organized, and universally shareable.**  
✔ **Easily import/export contacts between Obsidian and your favorite apps.**  
✔ **Covers nearly all real-world use cases personal, work, or hybrid.**  
✔ **Integrates contacts directly into your knowledge graph.**  
✔ **Feels native, modern, and fun to use.**

Start using the plugin today and share your experience in the [💬 GitHub Discussions](https://github.com/broekema41/obsidian-vcf-contacts/discussions)!

---

## 🌍 Access up to date Contacts on Devices (IOS, Android) and apps. 

This feature is for the slightly tech-savvy... or you are lucky enough to have a privacy conscious tech friend nearby!
We assume you have a CardDAV server running, know how to spin one up, or use a hosted service that does the job for you.

A typical setup looks like this:
```markdown
Obsidian VCF Contacts Plugin
        ↓
Contacts DAV Server
        ↓
 ├── DAVx⁵ → Android Contacts (read only) 
 ├── iOS Contacts (read only)
 └── Thunderbird (or any CardDAV-capable email client) (read only) 
```

![VCF Contacts Plugin carddav end result](assets/vcf-contacts-plugin-with-carddav.jpg)

#### CardDAV Server Options

You can self-host or use cardav provider. There are many, some popular options:

* **Baïkal** lightweight and easy docker container to run
* **Radicale** minimal, Python-based
* **Nextcloud Contacts** a popular alternative cloud service
* **SOGo** open-source groupware server

#### Synchronization Settings

In the plugin setting page select "sync method" CardDav. Here you can fill in the Address Book URL and credentials. pressing "Enable" button will test the connection and enable the sync when ok 

* Basic authentication (username + password)
* API key authentication

OpenID Connect (OAuth2) is not supported at this time.

#### Syncing a contact

Run the command **Sync this contact**, or click the sync icon on the contact in the sidebar and choose **Sync**. If the note and the address book card are the same, you only get the notice "Up to date". Otherwise a review screen opens. Nothing about this contact is written until you click **Apply** (an **Import**, see below, first creates the other person's note).

The screen has one row for each property that differs, with the address book value, the Obsidian value and the Result. The address book column is labelled with the name of the address book (for example "Family"). Click the address book's name or **Obsidian** in a row to choose which value wins, or type your own text in the "Edit result" field. Values with several lines keep their line breaks, and their "Edit result" field has several lines too. Photos are shown as small pictures. **All from <address book>** and **All from Obsidian** choose a side for every row at once, and **Show all** also lists the properties that are the same on both sides.

Most rows are already chosen for you. The plugin remembers the card as it was after the last sync. A property that changed only on the server is preselected from the address book, and one that changed only in Obsidian is preselected from Obsidian. For a card that is not on the server yet ("New card in ..."), everything comes from Obsidian: the address book column says "Not in <address book> yet", and there are no address book buttons.

When a property changed on both sides (or there is no earlier sync to compare with), it is a conflict. The row says "Conflict: choose one", and **Apply** stays disabled until you have decided every conflict; next to it the screen says how many are left ("Decide 2 conflicts"). An empty "Edit result" does not decide a conflict. In a row without a conflict, an empty "Edit result" removes the property, and the screen says "(will be removed)".

If the contact list of an address book could not be read, the screen says so at the top: relationships to people who are only in that address book may then show as changed.

**Cancel** (or Escape) closes the screen. Nothing about this contact is written, in the note or on the server (a note made with **Import** stays).

Some things come with a choice:

- **Also changes** lists what happens in other contact notes because of your choices, for example "Sem: parents gets [[Jan]]", when relationships are mirrored.
- If a relationship points to someone who is on the server but has no note yet, the row shows an **Import** button for that person. It creates the note, and the review opens again. When relationships are mirrored, the new note's relationship can be added back to this contact's note, so the screen may open once more with that change.
- If your choices change the contact's name, **Rename note to ...** is offered, ticked. Untick it to keep the file name. It is disabled when another note in the folder already has that name.
- To move a contact to another address book, change `source:` in the note to the name of that book and sync. The screen shows "Address book: <from> -> <to>", and Apply moves the card.

If the card changed on the server since the screen opened, Apply tells you and the screen opens again with the new values.

---

## 🔧 Development

For plugin development:
```bash
# Install dependencies
npm install

# Build the plugin
npm run build

# Development build
npm run dev
npm run dev watch   # with auto-rebuild on changes
```

---

## 📘 Testing strategy
Our goal is to maintain high-confidence, non-UI testing that focuses on:
* Validating all resolved production bugs.
* Thoroughly testing deep module interfaces (e.g., parsing, formatting, file logic, syncing, processors etc)

Use the following commands to run tests and view coverage:
```bash
npm run test
npm run test:coverage
```

For a breakdown of our testing approach, structure, and goals, see:
👉 [our testing strategy](assets/docs/testing-strategy.md)




---

## 🌟 Support & Get Involved

We rely on our community to keep this project free and moving forward. If you believe in what we’re building, now’s the perfect time to step out of the shadows and help shape the future of this plugin!

Spread the word, connect us with sponsors, or simply share your enthusiasm, your support matters.

Ready to make a difference? [Sign up here.](https://tally.so/r/mR6rKj)

---

<!-- TOC --><a name="-acknowledgements"></a>
## 🙏 Acknowledgements

Friendly Contacts is a fork of **[VCF Contacts](https://github.com/broekema41/obsidian-vcf-contacts) by Roland Broekema**; nearly everything in this README, and most of the plugin, is his work.

This plugin started as a fork of **Vadim Beskrovnov’s Contacts plugin**. While the codebase has since evolved significantly, his original work laid the foundation. Immense thanks to Vadim for the early inspiration and groundwork.


---
