

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
      + [👪 Relationships in the sidebar](#-relationships-in-the-sidebar)
      + [📱 Relationships on phones](#-relationships-on-phones)
      + [🔗 Links to Obsidian notes on cards](#-links-to-obsidian-notes-on-cards)
      + [📅 Dates with a label](#-dates-with-a-label)
      + [🕸️ People graph](#-people-graph)
      + [🔎 Searching Contacts (Fast!)](#-searching-contacts-fast)
   * [📖 Understanding the vCard (VCF) Format](#-understanding-the-vcard-vcf-format)
   * [📄 Example Contact Note (Foo Bar)](#-example-contact-note-foo-bar)
   * [📌 Supported vCard Fields](#-supported-vcard-fields)
      + [📞 Basic Contact Information](#-basic-contact-information)
      + [🏠 Address Fields](#-address-fields)
      + [🏷️ Property names in the settings](#-property-names)
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

4) **Friendly Contacts: Add relationship…**  
With a contact note open: pick another contact, then the relationship (see [Relationships in the sidebar](#-relationships-in-the-sidebar)).

---

<!-- TOC --><a name="-create-a-new-contact"></a>
### ➕ Create a New Contact

1. Click **Create Contact**
2. Fill in:
   - `Given Name`
   - `Family Name`
   - `Address book`, when two or more address books are enabled: the default address book is preselected (when it is disabled, the first enabled one), and your choice is written as `source:` in the new note. Disabled address books are not listed. With one enabled address book (or none) the field is not shown; when that one book is not the default (the default is disabled), the new note gets `source:` with that book.
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
- **Folder note name**: the file name of the folder note, without `.md`. `{{name}}` stands for the contact's name, so the default `{{name}}` gives `Jan de Vries/Jan de Vries.md`. You can also type a fixed name such as `index`, then every contact's note is called `index.md` (`Jan de Vries/index.md`) and the folder carries the name. A name that cannot work (empty, ending in `.md`, a character that is not allowed in file names, starting with a dot or ending in a dot or space, any `{{...}}` other than `{{name}}`) is shown with the reason and is not saved until you fix it. While the folder settings are not usable, the plugin works as one note per contact and shows a notice that says why.
- **Fixed-name hint**: with a fixed name, the settings page adds "Obsidian's graph and tabs will show every contact as "index"." Obsidian shows file names there, and they are all the same. (Links to the contact get the contact's name as a label, see below.)
- **Contacts in folders made with other settings**: when you change the folder note name or location while contacts are in folders (for example from `{{name}}` to `index`), the settings page says "N contacts are in folders made with other settings." A folder counts as a contact's folder when it is named for a contact note in it (its `name` property or its file name), whatever the settings. Such contacts are not put in folders again, new contacts are not created in their folders, **Move contacts to folder…** moves them with their whole folder and a rename through Sync renames their folder too. Their note keeps its naming: `Jan/Jan.md` becomes `Johan/Johan.md`, `Jan/index.md` becomes `Johan/index.md`. All this also holds when you went back to *One note per contact* without taking the contacts out. One side effect: in *One note per contact* with *Next to the folder* still stored, a contact note with a folder of the same name beside it (`Contacts/Jan.md` and `Contacts/Jan/`) is treated as owning that folder, even if you made the folder for something else, so **Move contacts to folder…** moves it along and a rename through Sync renames it. To match the new settings, take the contacts out and put them in folders again.
- **Folder note location**: *Inside the folder* (`Contacts/Jan de Vries/Jan de Vries.md`) or *Next to the folder* (the note is beside its folder: `Contacts/Jan de Vries.md` and `Contacts/Jan de Vries/`). *Next to the folder* needs `{{name}}` in the folder note name, otherwise every contact would get the same file name.
- **Copy from Folder Notes**: when the Folder Notes plugin is installed, this button copies its folder note name (its `{{folder_name}}` becomes `{{name}}`) and location, so the two plugins agree. If Folder Notes is set up differently from this plugin, the settings page says "Folder Notes uses different settings." Copying is refused, with a notice that says why, when Folder Notes uses something that cannot be copied, for example a folder note type other than `.md`, or folder notes stored in the vault folder.

**Creating a contact**

A new contact is created in the contacts folder, or in the folder of the note you have open when that is inside the contacts folder. It is never created inside another contact's folder (also not one made with other settings, or when you went back to one note per contact): then it goes next to that folder. If the contact's folder already holds a contact (for example an `index.md` from before you changed the folder note name), the plugin asks before creating the note there anyway.

**Switching existing contacts: two commands**

- **Put each contact in its own folder** creates a folder for each contact note in the contacts folder and moves the note into it, using the settings above. Set the layout to *Folder per contact* first. A contact is skipped when its folder already exists with something in it (an empty folder is used), when its note's target exists, when two contacts would get the same folder, or when it is already in a folder made with other settings. Links to the notes keep working, because the notes are moved through Obsidian; with a fixed note name the plugin also rewrites relationship links to the moved contacts (see below).
- **Take contacts out of their folders** moves each contact note out of its folder, next to where the folder was, named after the contact (`Jan de Vries.md`). With *Inside the folder* the note first leaves under a temporary name (`Jan de Vries (moving).md`), the folder is removed when nothing else is left in it, and then the note gets its name. A folder that still holds a poem or a photo stays, with those files in it, and only the note leaves. So does a folder with hidden files (such as `.DS_Store`) or one that cannot be deleted. With *Next to the folder* the folder is never removed, not even when it is empty: the notice counts it as an empty folder left.

  Why: the Folder Notes plugin, with *Storage location* "In the parent folder" and *Delete folder notes when deleting the folder* on, would see `Contacts/Jan de Vries.md` as the folder note of `Contacts/Jan de Vries/` and delete it when that folder is removed. For the same reason no folder is ever removed while a note named like it is beside it.

Both commands only touch contact notes in the contacts folder. They never move or delete your other files, never overwrite anything, never delete a folder that is not empty, and never move the contacts folder itself. Contacts that are already in the wanted layout are left alone. Contact notes inside another contact's folder are not moved: they are skipped and counted. Paths that differ only in case (`Contacts/jan` and `Contacts/Jan`) count as the same, as they are on macOS and Windows, so nothing is merged into a folder with a differently cased name. When it is done a notice says how many were moved and skipped, how many folders were kept because other files are in them and how many empty folders were left; the details (which note, why) are in the developer console. Running a command again is safe.

If the Folder Notes plugin's *Auto-create on folder creation* is on, it puts a note in every folder this plugin creates before the contact note is moved in. When that note has the name the contact note would get, the contact is skipped (its target exists); either way an empty folder note is left behind. Turn auto-create off while you run the command, or expect those skips.

**Renaming a contact**

You rename a contact through Sync, like before: change the name in the note and run **Sync this contact**. When the note is in its own folder (also one made with other settings, or one left from folder layout), the review screen offers **Rename folder and note to <new name>** (ticked); otherwise it offers **Rename note to <new name>**. Whatever else is in the folder, such as the poem, moves along with the folder. With a fixed note name only the folder is renamed, the note stays `index.md`. Untick the box to keep the names.

The rename is blocked, and the box is disabled with the reason below it, when a folder or note with the new name already exists (also one whose name differs only in case), or when the contact's folder holds other contacts (then it is a category rather than this person's folder: rename it by hand). Nothing is ever overwritten. If the folder was renamed but the note cannot be, the folder is renamed back; if that fails too, the error says which files are now apart.

**Moving the contacts folder**

**Move contacts to folder…** works as before, and a contact in its own folder moves together with its whole folder and everything in it. That holds in every layout: also for a folder made with other settings, and for one left from folder layout after you went back to *One note per contact*. With *Next to the folder* the folder and its note move together. A contact whose target already exists is skipped, never merged, and you cannot move contacts into a contact's own folder (also not when the name you give differs only in case). If a move fails half way, what already moved is put back; if that is not possible the console says which files are now apart.

**Links when the folder note has a fixed name**

A link to `index` says nothing about whom it is, and Obsidian's short form `[[index]]` points to another contact as soon as there are two. So with a fixed note name the plugin always writes relationship links as the full path with the contact's name as the label, for example `[[Contacts/Jan de Vries/index|Jan de Vries]]`, also when there is only one contact. It does the same for any contact whose note is not named for it, such as an `index.md` left in a contact's folder after you changed the settings or went back to *One note per contact*. The label is the contact's `name` property; the folder's name is used only when that is empty.

When Obsidian updates links after a move it may write the short form again (with its default link format, "Shortest path when possible"). So when you put contacts in folders, rename a contact through Sync or move the contacts folder, the plugin notes beforehand which relationship entries point to those contacts and afterwards writes them as full paths again. A label that was the contact's old name gets the new one, also when the name was changed on the server; a label you wrote yourself is kept. Taking contacts out of their folders moves each note twice (via its temporary name), so there too the plugin notes the entries beforehand and afterwards makes every entry that no longer opens the contact point to its note again. Only relationship properties of contact notes are changed.

**Links in Obsidian's path formats**

Relationship links follow Obsidian's **New link format** (Settings → Files and links). With "Relative path to file" or "Absolute path in vault" a link is a path, such as `../Ger Verhallen/Ger Verhallen`, and a property shows that path. So the plugin writes such a link with the contact's name as the label: `[[../Ger Verhallen/Ger Verhallen|Ger Verhallen]]`. With "Shortest path when possible" a link to a note named for the contact stays `[[Ger Verhallen]]`. This works the same with or without the Folder Notes plugin. Properties only understand `[[wikilinks]]`, so relationship links are always wikilinks, whatever **Use [[Wikilinks]]** says.

**Tidy relationship links** (command) gives the links already in your notes this form: every relationship entry that is a path without a label gets the contact's name as its label. Putting contacts in their own folders does this for the contacts it moves. A label you wrote yourself is kept, and only relationship properties of contact notes are changed.

When you import a contact from the address book, relationships in other notes that pointed to nobody but name this contact become links to the new note (a label you wrote yourself is kept). **Import all** in the Import panel does this once at the end, for all the contacts it imported. This only happens with a fixed note name.

---

<!-- TOC --><a name="-relationships-in-the-sidebar"></a>
### 👪 Relationships in the sidebar

Each contact in the sidebar shows its relationships below its details, one line per relationship property (`spouse`, `children`, `friends`, …). A contact without relationships only shows a small **+ Relationship** button.

- **Click a name** to open that contact's note. A name in grey points to nobody: there is no contact note for it (yet).
- **+ Relationship** (or the command **Add relationship…** with a contact note open) first asks for the other contact, then for the relationship (`children (child)`, `friends (friend)`, …). Contacts with the same name show their folder in the list. The link is written the way the plugin writes all relationship links (see [A folder per contact](#-a-folder-per-contact)). If that contact is already listed there, a notice says so and nothing changes. A single relationship such as `spouse` is replaced after you confirm ("Replace Anna with Lot as spouse?"). A grey entry with the same name as the contact you pick, or with that name as its label, is turned into the link instead of listing the person twice.
- **×** removes the person from that relationship, after you confirm. If the write fails, a notice says so.
- **Import** appears next to a grey name when Sync is on and exactly one card on the server has that name, and that card has no note yet. It creates the note, as **Import contact from server…** does.
- **Link** appears instead of Import when that card already has a note (for example the entry says `[[Sem de Vries]]` while the note is `Sem.md`). It turns the grey entry into a link to that note, in its place.

The other side follows when relationships are mirrored (**Mirror relationships on this device**): adding Sem to Jan's `children` gives Sem `parents: [[Jan]]`, and removing it takes that away again. A single relationship on the other side is never overwritten: if Lot already has Piet as `spouse`, making Lot Jan's spouse leaves Lot's `spouse` as it is, and the plugin tells you so.

If the server cannot be read, the sidebar does not ask again for a minute.

---

<!-- TOC --><a name="-relationships-on-phones"></a>
### 📱 Relationships on phones

A card keeps the vCard version it has, and each property is written the way that version does it. vCard 3.0 has no `RELATED` property, so Apple Contacts and DAVx5 (Android) store relationships in a 3.0 card as a name with a label:

```
item1.X-ABRELATEDNAMES;X-FRIENDLY-UID=<uid>:Sem de Vries
item1.X-ABLabel:_$!<Child>!$_
```

- **Names, not codes.** The line holds the other person's display name (the `name` property, never a path or alias), so a phone shows "Sem de Vries". The label says what the person is: Spouse, Partner, Child, Parent, Mother, Father, Sibling, Brother, Sister, Kin, Relative, Friend, Colleague, Co-worker, Assistant, Manager, Neighbor, Co-resident, Acquaintance, Met or Emergency. Apple's built-in labels (Spouse, Partner, Child, Parent, Mother, Father, Brother, Sister, Friend, Assistant, Manager) are written as `_$!<Child>!$_`, the others as plain text. The `X-FRIENDLY-UID` parameter is a hint for this plugin only: it lets Sync find the exact contact when two people share a name. Phones ignore it.
- **Which apps read them.** Apple Contacts and DAVx5 (and the Android apps that read through it) show `X-ABRELATEDNAMES` with its label. A vCard 4.0 card holds the relationship as `RELATED;TYPE=child;VALUE=text;X-FRIENDLY-UID=<uid>:Sem de Vries`, which DAVx5 reads as well.
- **Reading goes both ways.** Sync reads every form, whatever the card's version: `RELATED` with a `urn:uuid:` value or a name (`VALUE=text`, or a value that is not a URI), and `X-ABRELATEDNAMES` by its label (built-in `_$!<Spouse>!$_` or plain text; a custom label of several parts, such as `Neighbor, Acquaintance`, matches when any part matches). A name keeps pointing at the same contact when a phone drops the `X-FRIENDLY-UID` hint: the link in your note stays as it is. A relationship you enter on the phone therefore shows up in Obsidian after Sync. A relationship with an unknown label (say "Godfather") or none at all is not mapped; it stays on the card untouched.
- **Anniversary.** vCard 3.0 has no `ANNIVERSARY` either; on a 3.0 card the `anniversary` property is written as `itemN.X-ABDATE` with the label `_$!<Anniversary>!$_`, and read from there. An `X-ABDATE` in the year 1604 is an anniversary without a year, also without the `X-APPLE-OMIT-YEAR` parameter (DAVx5 leaves it out there).
- **Only what changed is written.** Adding a relationship adds its line and its label; removing it removes both. Every other line stays as it was.
- **Keeping a relationship off the cards.** To keep a relationship such as `friends` in Obsidian only, switch off its Sync in the Properties tab of the settings (see [Property names in the settings](#-property-names)).

**`partner` and `spouse`.** They are two relationships, each single, each mirrored by itself. `spouse` is labelled Spouse (type `spouse` on a 4.0 card); `partner` is for a partner you are not married to, labelled Partner (type `sweetheart` on a 4.0 card; type `partner`, which DAVx5 writes for Android's Partner, is read too). A person can have both. In the people graph a partner is drawn as a partner, like a spouse.

**Cards the plugin wrote earlier.** Older versions wrote `RELATED;TYPE=child:urn:uuid:<uid>` in every card, which phones show as a code or not at all. On a 3.0 card the next Apply that writes the card rewrites those lines into the form above. On a 4.0 card such a line gets the contact's name and the hint in place (`RELATED;TYPE=child;VALUE=text;X-FRIENDLY-UID=<uid>:Sem de Vries`); a line with several types keeps all of them. A `urn:uuid:` that no contact has stays as it is. DAVx5 may already have turned such a line into a name that reads "urn:uuid:…" (`item1.X-ABRELATEDNAMES:urn:uuid:<uid>` on a 3.0 card, `RELATED;TYPE=child;VALUE=text:urn:uuid:<uid>` on a 4.0 card): Sync reads it as a link to the contact with that UID, never as a person called "urn:uuid:…", and Apply writes the contact's name with the hint into that line, in its own form, on 3.0 and 4.0 cards. A line that names a contact you renamed since gets the new name the same way. When that is the only difference between the note and the card, the review screen opens with the line "Relationships on this card are rewritten in the form phones understand." and no property rows; click **Apply**. After that the card is up to date. Lines another app wrote (a name without the hint, or a `RELATED` line with several types that holds no `urn:uuid:`) are left as they are.

#### New contacts: Automatic, vCard 3.0 or vCard 4.0

Each address book has a setting **New contacts** (in the address book's section of the plugin settings) with three choices: **Automatic** (the default), **vCard 3.0** and **vCard 4.0**. It decides the version of a card the plugin creates for a new contact. Automatic uses the version most of the cards in that address book have; an empty address book or a tie gives 3.0, the version every app understands. The version is looked at when the card is created (the first Sync of the new note), from the address book's contact list, which is cached for a few minutes. If the address book cannot be read, the new card is 3.0 and a notice says so.

**Count card versions** next to it counts the versions in the address book and shows, for example, "118 × vCard 3.0, 4 × vCard 4.0; Automatic gives new contacts vCard 3.0." Nothing is changed by counting.

**Radicale and photos on vCard 4.0 cards.** Radicale (through its vCard parser, vobject) damages a photo stored as a `data:` URI, which is how vCard 4.0 holds an embedded photo: it comes back without the image. On vCard 3.0 cards photos come through intact. Sync recognises such a damaged photo and never puts it into your note. It counts as the photo of the last Sync: an edit elsewhere on the card does not touch your note's photo, and a photo you add, change or remove in the note is written once, without a Sync loop. A phone cannot show such a photo either; DAVx5 then sends the card back without it at its next edit, and that is not taken for a removal. A photo added on a phone is lost on the server itself, so Sync cannot bring it into your note. Phones get no photo from such a 4.0 card, so on Radicale set **New contacts** to **vCard 3.0**.

A note into which an earlier version wrote such a damaged photo is put right at its next Sync: the review says so, and Apply removes the damaged value, or puts back the photo of the last Sync. A photo you then put back in the note is written to the server once. If a phone already sent such a card back without its photo before you updated, Sync cannot tell that from a removal and offers to remove the photo once: keep the Obsidian side. **Update the plugin on every desktop that shares the vault**: an older version keeps writing the damaged photo into the shared notes.

**When your server starts offering vCard 4.0.** Existing cards keep the version they have: the plugin never converts a card from one version to another (phones rewrite a card in their own version anyway). Only new cards follow: as phones and the server store more 4.0 cards, the majority in the address book changes, and Automatic starts creating 4.0 cards once most of the cards are 4.0. Set the book to vCard 3.0 or vCard 4.0 to fix the version of new cards yourself.

---

<!-- TOC --><a name="-links-to-obsidian-notes-on-cards"></a>
### 🔗 Links to Obsidian notes on cards

With the setting **Links to Obsidian notes on cards** (in the synchronization settings of the plugin, right below the address books) every card gets a website for each relationship with a contact note: an `obsidian://` link to that note, labelled with the person's name. It is off by default.

```
item4.URL:obsidian://open?vault=Phone%20Notes&file=Contacts%2FSem%20de%20Vries
item4.X-ABLabel:Sem de Vries
```

- **For phones.** The link is a website entry on the card, the same in vCard 3.0 and 4.0 cards. On Android (DAVx5) you tap it in the contact to open the note in Obsidian. Whether the contacts app opens `obsidian://` links depends on the app, so test it with one contact on your phone first.
- **Vault name on your phone.** The link names the vault to open. The first time you turn the setting on, the field **Vault name on your phone** is filled with the name of this vault. Change it when the vault on your phone has another name; an empty field gives the name of this vault again. Links with an earlier vault name are replaced at each contact's next Sync.
- **One link per contact note.** A person you have two relationships with gets one link. Relationships to someone without a contact note get no link, and a card gets no link to its own note.
- **At each contact's next Sync.** Links follow the relationships, a renamed contact, the vault name and turning the setting off. A card that has to change shows the line "Links to Obsidian notes on this card are updated." on the review screen; click **Apply**. A link you delete on the phone, or a label you change there, is put back at the next Sync. Turning the setting off removes the links from the cards.
- **Only the plugin's own links.** The links never appear in your notes. An `obsidian://` website in a group (like `item4.URL` above) to the vault named in the field (or a name it had before) counts as one of the plugin's links, even one you typed on the phone, and is replaced or removed. Websites in your notes (written to the card as plain website lines) and links to other vaults are never touched.
- **Update every desktop first.** Update the plugin on every desktop that syncs before you turn the setting on: an older version reads the links as websites and puts them in your notes. The other desktops must also pick up the setting before they sync. They do so by themselves when the plugin's settings file syncs to them (Obsidian Sync or another file sync); otherwise restart Obsidian there.

---

<!-- TOC --><a name="-dates-with-a-label"></a>
### 📅 Dates with a label

A phone can keep a date under a label of its own, for example "Verkering" for the day two people started dating. Apple Contacts and DAVx5 (Android) store it on the card as a date with a label:

```
item3.X-ABDATE:2012-05-01
item3.X-ABLabel:Verkering
```

The group **Dates with a label** in the plugin settings, right below the property names, gives such a label a property in your notes. Each row has the label on the card and the property in the note, for example `Verkering` and `dating`. The note then holds `dating: 2012-05-01`, and the phone keeps showing the date under "Verkering". A date you fill in in the note goes to the card with its label, in vCard 3.0 and 4.0 cards alike. A second date with the same label goes to `dating-2`, the next to `dating-3`, and so on.

- **English names.** The plugin does not translate labels; you name the property. Use an English name (`dating`, not `verkering`), like the other properties in your notes.
- **Anniversary** is the first row. Its label is fixed; you can rename its property.
- **Adding a row.** Type the label and the property in the empty line at the bottom and click **Add**. When contacts already have that date on their card, the plugin asks "Add dating to 2 contact notes, from their last Sync?" and fills the property in those notes first, so the next Sync does not take the date for one you removed in Obsidian. A value you already typed in a note is kept. If a note cannot be filled, the row is not added. On your other devices, and for notes that were not filled, a date that already sits on a card shows up in the note at that contact's next Sync; it is never removed from the card.
- **Find labels on cards** lists the labels on your contacts' cards that have no row yet, such as "Verkering — on 2 contacts". **Add** next to a label puts it in the empty line with a suggested property name; change that into English and click **Add**. It reads the cards as they were at each contact's last Sync: a label you added on the phone since then shows up after you sync that contact.
- **Changing a label.** The label of a row cannot be edited: remove the row and add it again.
- **Removing a row** never touches the cards: the dates stay there and stop showing in Obsidian. The property is removed from your notes (`dating`, `dating-2`, …), after a question that says how many notes change, so a row added again later starts clean.
- **Reset to defaults** in the property names keeps the rows of this group: they are your own labels. If one of them has a name a default property takes back (say you renamed `birthday` and gave a label the name `birthday`), nothing is saved and the settings show why.
- **Dates without a label** (Android's "Other" date without a text) are not shown; they stay on the card as they are.

---

<!-- TOC --><a name="-people-graph"></a>
### 🕸️ People graph

The people graph draws your contacts as circles and their relationships as lines, coloured by kind: partner, family, friends, work and other. It is drawn from the relationship properties in the contact notes (`spouse`, `children`, `friends`, …) and follows them while you edit.

**Opening it**

- The ribbon icon **Open people graph** or the command of the same name draws the graph around you (see below), else around the contact note you have open, else everyone.
- The command **Open people graph for this contact**, or the **Graph** button on a card in the sidebar, draws it around that contact.
- An open graph is reused; it keeps its depth and kinds.

**This is me**: Settings → **This is me** → **Choose** picks the contact that is you (only contacts with a UID are listed). The graph then opens around you. **Clear** forgets it.

**Toolbar**

- **Depth** (1–4, or *Everyone*): how many steps from the centre are drawn. *Everyone* draws every contact that has a relationship.
- The kind pills turn a kind of relationship on or off. A person reached only through a kind that is off is not drawn.
- **Open note** opens the centre's note. **Recenter** moves the centre back to the middle and lets go of every person you dragged.
- With more than 500 people to draw the graph asks for a smaller depth. Without a centre it asks you to set "This is me" or to open the graph from a contact.

**Clicking and dragging**

- **Click or tap** a person to make them the centre. **Click or tap the centre** to open their note (this is the way on a phone). **Double-click** or **Ctrl/Cmd-click** a person opens their note directly.
- **Drag** a person to put them somewhere; they stay there until **Recenter**. A click that hardly moves is a click, not a drag. Drag the background to pan, scroll or pinch to zoom.
- Zoomed out the graph shows dots, closer in names and initials, close up photos.

**Labels**: a line's label says what the person at that end is, seen from the end nearer the centre, and it sits near the person it describes. Centred on Jan with `children: [[Sem]]`, the line says `child` next to Sem; centred on Sem it says `parent` next to Jan, also when Sem's note does not list Jan under `parents`. A relationship without a mirror (`emergency`) reads the other way round from its other end: centred on Piet, Jan's `emergency: [[Piet]]` says `emergency contact of` next to Jan. Two people who both list the other as their child get two lines, so the contradiction shows.

**People without a note (ghosts)**: a relationship that points to nobody is drawn as a dashed circle with its name in italics: the link's label, else the last part of the link (`[[Contacts/Jan/index|Jan]]` shows `Jan`). Clicking it, with Sync on, first says "Looking up <name>…", then opens that person's note when exactly one card on the server has that name and it already has a note, or offers to **Import** the card when it has none. Otherwise it says the person has no note.

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
| `GENDER`            | Gender (and optional identity) | `M`, `F`, `O`, `N`, `U`, `O;non-binary` |
| `ORG`               | Organization Name              | `FakeCorp Inc.`             |
| `ORG` (second part) | Department                     | `Research`                  |
| `TITLE`             | Job Title                      | `Senior Developer`          |
| `ROLE`              | Job Role                       | `Software Engineer`         |

`GENDER` holds one letter, `M`, `F`, `O`, `N` or `U`, and may be followed by `;` and a free text identity (`O;non-binary`). In the note these are the `gender` and `gender-identity` properties. A vCard 3.0 card has no `GENDER`; there a new line is written as `X-GENDER`, and a line that is already on the card keeps its own name. Some servers, such as Radicale, store `O;non-binary` as `O\;non-binary`; the plugin reads both the same way. An identity that itself contains `;` does not survive such a server: `a;b` comes back as `a`. Phones do not show the gender.

Dates without a year, such as a birthday or anniversary where the year is unknown, are written `--MM-DD` (for example `--03-15`). Keep the `birthday` and `anniversary` properties as Text properties in Obsidian; the Date type rejects that form.

---

<!-- TOC --><a name="-address-fields"></a>
### 🏠 Address Fields

| **vCard Field**         | **Readable Name**             | **Example**                  |
|-------------------------|-------------------------------|------------------------------|
| `ADR[HOME].POBOX`       | Home PO Box                   | `PO Box 12`                  |
| `ADR[HOME].EXTENDED`    | Home Extra Address Line       | `Apartment 4`                |
| `ADR[HOME].STREET`      | Home Street Address           | `123 Fake Street`            |
| `ADR[HOME].LOCALITY`    | Home City                     | `Faketown`                   |
| `ADR[HOME].REGION`      | Home State/Province           | `FakeState`                  |
| `ADR[HOME].POSTAL`      | Home Postal Code              | `00000`                      |
| `ADR[HOME].COUNTRY`     | Home Country                  | `Nowhere Land`               |
| `ADR[WORK].POBOX`       | Work PO Box                   | `PO Box 99`                  |
| `ADR[WORK].EXTENDED`    | Work Extra Address Line       | `Floor 3`                    |
| `ADR[WORK].STREET`      | Work Street Address           | `789 Corporate Ave`          |
| `ADR[WORK].LOCALITY`    | Work City                     | `Business City`              |
| `ADR[WORK].REGION`      | Work State/Province           | `IndustryState`              |
| `ADR[WORK].POSTAL`      | Work Postal Code              | `99999`                      |
| `ADR[WORK].COUNTRY`     | Work Country                  | `Enterprise Land`            |

---

<!-- TOC --><a name="-property-names"></a>
### 🏷️ Property names in the settings

The plugin settings have three tabs: **General**, **Sync** (the address books and the links to Obsidian notes on cards) and **Properties**. The Properties tab lists the property names of your notes, in groups (Name, Phone, email and web, Work, Address, Dates, Relationships, Other). Every part of a card field has its own property, so a name prefix, a name suffix, a department, a gender, a gender identity, a PO box and an extra address line (home and work) are all properties you can use. Each property has a Sync switch in the list. Click a property to see its details beside the list (in a narrow window: right under it):

- **Name in note**: the property in your note.
- **Read from**: the card field or fields it is read from, for example `GENDER, X-GENDER`. For a relationship: the relationship types on cards, and **Mirrored by**, the property the other contact gets.
- **Part**: which part of the field the property is, counting from 1. `ORG` has the company as part 1 and the department as part 2; `N` has the prefix as part 4 and the suffix as part 5.
- **Write as (vCard 4.0)**: the field a new line gets on a vCard 4.0 card.
- **Write as (vCard 3.0)**: the field a new line gets on a vCard 3.0 card. Leave it empty (`same as 4.0`) to use the 4.0 field. The gender properties use it to write `X-GENDER`, because vCard 3.0 has no `GENDER`. Properties that are parts of the same field (the same Write as (vCard 4.0)) need the same vCard 3.0 field, because they share one line. The relationships and the anniversary, and `uid`, `name` and `photo`, show their 3.0 form as plain text, which you cannot change.
- **Sync**: switch it off to keep the property out of Sync and Import. The property stays in your notes, but Sync, Sync all contacts and Import no longer read it from cards or write it to them, and the review never shows it. Switching off itself changes no note and no card, and the property's lines already on a card stay there; remove them yourself if you want them gone. Only when **Links to Obsidian notes on cards** is on (see [Links to Obsidian notes on cards](#-links-to-obsidian-notes-on-cards)) can switching off lead to a card change: a person who is reached only through relationships with Sync off gets no link to their Obsidian note on cards, and a link already there goes at the next Apply. So with that setting on, switching off a relationship makes Sync (and **Sync all contacts**) list the contacts whose only link to someone came through it, and Apply removes those `obsidian://` lines from their cards; they are the plugin's own link lines, not the property's lines. Switching it on again does not take anything out of a note: the differences show up in the review as changes in Obsidian or on the server, or as a conflict, and nothing that removes a value from a note is preselected. `uid`, `name` and `photo` are always synced; their switch is on and cannot be changed. Export to a `.vcf` file is not affected. The setting is stored with the property names, so update the plugin on every desktop: an older version ignores it and syncs the property as before.

A line that is already on a card keeps its own field name when you edit it; the write columns only name new lines. The card's `VERSION` never changes.

Changing **Read from** or **Part** only changes how cards are read from now on. It does not fill your notes again by itself.

Update the plugin on every desktop before you sync from it. An older version does not know the new parts, so it would offer to remove them from the card.

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

#### Importing contacts from your address books

Click the **inbox** button in the sidebar's top bar (**Import contacts from address books**) to open the Import panel. It lists the cards on your address books that have no note yet, grouped per address book: the heading shows the book's name and how many contacts it has, with an **Import all** button for that book. Each row shows the contact's name (and ` · organisation` when the card has one), an **Import** button and a **×** that hides the contact from the list until Obsidian restarts.

Type in the search field to filter on name and organisation. Case and accents do not matter: "rene" finds "René". **Import all** at the top imports everything the filter shows, after a question that names the number of contacts and address books. A contact that already has a note is not imported again, and a name that clashes with an existing note keeps the contact in the list with a notice. The small **Other** section at the bottom only appears when a background check has something to tell you. The background checks can be switched off in the settings, under **Background checks**.

#### Syncing a contact

Run the command **Sync this contact**, click the sync icon on the contact in the sidebar and choose **Sync**, click the **Sync contact** icon (two arrows in a circle) at the top right of an open contact note, or choose **Sync contact** in the note's ⋯ menu (also in the right-click menu of the file explorer). The icon and the menu item only show on a contact note, and only when an address book is set up. Every open contact note has its own icon, also in split panes. If the note and the address book card are the same, you only get the notice "Up to date". Otherwise a review screen opens. Nothing about this contact is written until you click **Apply** (an **Import**, see below, first creates the other person's note).

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
- A 3.0 card that still holds relationship lines from older versions of the plugin shows the line "Relationships on this card are rewritten in the form phones understand." and Apply writes them in the new form (see [Relationships on phones](#-relationships-on-phones)).

If the card changed on the server since the screen opened, Apply tells you and the screen opens again with the new values.

#### Sync all contacts

To see every contact that differs from its card at once, run the command **Sync all contacts** or click the **Sync all contacts** icon (two arrows in a circle) in the sidebar's top bar. The button is only there when an address book is set up. A tab opens and looks at all your contact notes. It does not change any note or card. (Like **Sync this contact**, it does remember the card when the note and the card already agree.)

The list on the left holds the contacts that differ, the review of the selected one is on the right, the same screen as **Sync this contact**. A badge on each contact says what Apply would do: **Conflict** (you still have to choose), **From <address book>** (values come from the server), **From Obsidian** (values go to the server) and **New card** (the contact has no card yet). Contacts that are the same on both sides are not listed; the top of the tab says how many there are. **Previous** and **Next** (or the arrow keys in the list) move through the contacts.

- **Apply** applies the selected contact with the choices you made, just like Apply in the review of **Sync this contact**.
- **Apply all that are ready** applies every ready contact, one after another, with the choices shown for each one: the preselected values plus any you changed, and the rename box as it is ticked (ticked by default). It does all that Apply does in **Sync this contact**: it renames the note or folder when that is offered, writes the "Also changes" into the related notes, and moves cards to another address book. The number in the button is how many contacts are ready. It skips contacts with a conflict you did not decide, **New card** contacts, and contacts with a warning (badge **Check warning**, for example an address book that could not be read). Apply those one by one with **Apply**; a new card is only created that way.
- If a note or its card changed after the scan, Apply does not write anything. The contact stays in the list with the line "Changed since the scan; check it again." and the new values, so you decide again.
- **Scan again** reads everything anew. Running the command or clicking the button again while the tab is open also scans again. Closing the tab stops the scan.
- If Apply cannot be done (for example the server cannot be reached), the contact stays in the list with your choices and a line "Not applied: <reason>".
- Contacts that cannot be synced now (for example a note that still needs **Convert**, or a Sync of that contact that is open) are listed under **Cannot be synced**, with the reason.

Cards that are only on the server are not listed here; bring them in with the Import panel.

#### Turning Sync off for a note: `sync: false`

Put `sync: false` in a note's properties and that note is never synced. **Sync all contacts** leaves it out, and **Sync this contact** says "Not syncing <name>: sync: false is set in this note." The text `false` in any case works too. Remove the property (or set it to `true`) to sync the note again. To keep one property out of Sync for every contact instead, switch off its Sync in the Properties tab of the settings (see [Property names in the settings](#-property-names)).

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
