import { App, Notice } from "obsidian";
import * as React from "react";
import {
  isLabelledDateRow,
  labelledDateRow,
  mappingWithLabelledDate,
  planDateFill,
  readableLabel,
  withLabelledDateRows,
} from "src/contacts/friendly/dateLabels";
import { isRemovableRow, ownRow, suggestedPropertyName } from "src/contacts/friendly/ownRows";
import { DEFAULT_MAPPING, isFixedProperty, mappingRenames, MappingRow, RelationRow, renameRow, syncSafeReset, validateMapping, withSync } from "src/contacts/friendly/mapping";
import { noteLinkOptions } from "src/contacts/friendly/noteLinks";
import { fillNotes, NoteWithBase, notesWithBases, notesWithRowProperties, removeRowProperties, touchBases } from "src/contacts/labelledDates";
import { notesToRename, renameBlockers, renamePropertyInNotes } from "src/contacts/obsidianNotes";
import { getSettings, setSettings, updateSetting } from "src/context/sharedSettingsContext";
import {
  inNewContacts,
  nameProperties,
  newContactAddition,
  newContactProperty,
  renameNewContactKeys,
  withNewContactProperty,
} from "src/settings/newContactFields";
import { mirrorRelationsOnThisDevice, setMirrorRelationsOnThisDevice } from "src/settings/deviceSettings";
import { ConfirmModal } from "src/ui/modals/confirmModal";
import { CommitInput } from "src/ui/settings/components/commitInput";
import { DateLabelsSettings } from "src/ui/settings/components/dateLabelsSettings";
import { NewContactsSettings } from "src/ui/settings/components/newContactsSettings";
import { useSettings } from "src/ui/hooks/settingsHook";
import { Toggle } from "src/ui/settings/components/toggle";
import { groupRows } from "src/ui/settings/propertyGroups";

const splitPatterns = (text: string): string[] =>
  text.split(",").map((p) => p.trim()).filter((p) => p !== "");

/** A failed add or remove of a date with a label: a notice, and the error in the console. */
const reportFailure = (action: "add" | "remove", property: string, error: unknown) => {
  console.error(`Friendly Contacts: could not ${action} ${property}`, error);
  new Notice(`Could not ${action} ${property}: ${error instanceof Error ? error.message : String(error)}`);
};

const SAME_AS_4 = "same as 4.0";

/** The 0-based index for the Part a person typed (1, 2, ...); NaN for anything else, which `validateMapping` reports. */
const partIndex = (text: string): number => {
  const t = text.trim();
  return /^\d+$/.test(t) && Number(t) >= 1 ? Number(t) - 1 : NaN;
};

/** The row with its vCard 3.0 write key set; an empty key removes it (the 3.0 card gets the 4.0 key). */
const withWriteV3 = (row: MappingRow, key: string): MappingRow => {
  if (row.kind === "relation") return row;
  const { writeV3: _removed, ...rest } = row;
  return (key === "" ? rest : { ...rest, writeV3: key }) as MappingRow;
};

/** A vCard key with a label, e.g. `X-ABRELATEDNAMES · label Friend`; the key never breaks over two lines. */
const keyWithLabel = (key: string, label: string) => (
  <><span className="vcf-mapping-key">{key}</span>{` · label ${label}`}</>
);

/** What a relation is written as on a vCard 3.0 card: the label on `X-ABRELATEDNAMES`, or the 4.0 form without one. */
const relationWriteV3 = (row: RelationRow): React.ReactNode => {
  const label = (row.labels ?? [])[0]?.trim() ?? "";
  return label === "" ? SAME_AS_4 : keyWithLabel("X-ABRELATEDNAMES", label);
};

const BASES_NOT_UPDATED = "Some sync bases could not be updated; see console.";

const SYNC_OFF =
  "Sync off: the property stays in your notes, but Sync and Import no longer read it from cards or write it to them. " +
  "Lines already on a card stay there; remove them yourself if you want them gone.";

/** Below this width the details of a property open under its line instead of beside the list. */
const NARROW_WIDTH = 560;

/** True while the element is narrower than `width`; false where the width cannot be measured. */
function useNarrow(ref: React.RefObject<HTMLElement>, width: number): boolean {
  const [narrow, setNarrow] = React.useState(false);
  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const check = () => setNarrow(element.clientWidth > 0 && element.clientWidth < width);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, width]);
  return narrow;
}

/** One setting in the details of a property: its name and description, and the control. */
function Field({ name, description, children }: { name: string; description: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="setting-item">
      <div className="setting-item-info">
        <div className="setting-item-name">{name}</div>
        <div className="setting-item-description">{description}</div>
      </div>
      <div className="setting-item-control">{children}</div>
    </div>
  );
}

/** "Add a property": a card field and a name for it; the name is suggested from the field while left empty. */
function AddPropertyLine({ onAdd }: { onAdd: (cardField: string, property: string) => Promise<string | undefined> }) {
  const [cardField, setCardField] = React.useState("");
  const [property, setProperty] = React.useState("");
  const [error, setError] = React.useState<string | undefined>(undefined);
  const add = async () => {
    const problem = await onAdd(cardField, property);
    setError(problem);
    if (problem === undefined) {
      setCardField("");
      setProperty("");
    }
  };
  const onEnter = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void add();
    }
  };
  return (
    <div className="setting-item vcf-add-property">
      <div className="setting-item-info">
        <div className="setting-item-name">Add a property</div>
        <div className="setting-item-description">
          For a card field no property reads yet, such as <code>X-BANAAN</code> or <code>TEL[FAX]</code>. It then shows
          in the list with all its settings.
        </div>
        {error && <div className="setting-item-description mod-warning">{error}</div>}
      </div>
      <div className="setting-item-control">
        <input
          type="text"
          aria-label="Card field"
          placeholder="Card field"
          value={cardField}
          onChange={(event) => setCardField(event.target.value)}
          onKeyDown={onEnter}
        />
        <input
          type="text"
          aria-label="Name in note"
          placeholder={suggestedPropertyName(cardField) || "Name in note"}
          value={property}
          onChange={(event) => setProperty(event.target.value)}
          onKeyDown={onEnter}
        />
        <button onClick={() => void add()}>Add property</button>
      </div>
    </div>
  );
}

export function PropertyNamesSettings({ app }: { app: App }) {
  const [rows, setRows] = React.useState<MappingRow[]>(() => getSettings().friendly.mapping);
  const saved = React.useRef<MappingRow[]>(rows);
  const [errors, setErrors] = React.useState<string[]>([]);
  /** Bumped by `revert`: the inputs are remounted so they show the saved values even when `rows` did not change. */
  const [revision, setRevision] = React.useState(0);
  const [mirror, setMirror] = React.useState(() => mirrorRelationsOnThisDevice(app));
  /** The Part text typed per row; shown while the row's part is invalid (NaN), so the input never reads "NaN". */
  const [partText, setPartText] = React.useState<Record<number, string>>({});
  /** The property shown beside the list (or under its line in a narrow pane), by name; the first one when absent. */
  const [selected, setSelected] = React.useState<string | undefined>(undefined);
  const layoutRef = React.useRef<HTMLDivElement>(null);
  const narrow = useNarrow(layoutRef, NARROW_WIDTH);
  const newContactKeys = useSettings()?.createFieldsKeys ?? [];
  /** Set when a property is picked outside the list: the list scrolls to it once it is shown. */
  const reveal = React.useRef(false);

  /** Saves the mapping; the fields of new contacts follow renamed properties. */
  const save = async (mapping: MappingRow[]) => {
    const current = getSettings();
    const createFieldsKeys = renameNewContactKeys(current.createFieldsKeys, mappingRenames(saved.current, mapping));
    await setSettings({ ...current, createFieldsKeys, friendly: { ...current.friendly, mapping } });
    saved.current = mapping;
  };

  /** Draft back to the saved mapping (a cancelled rename or reset). */
  const revert = () => {
    setRows(saved.current);
    setErrors([]);
    setRevision((r) => r + 1);
  };

  /**
   * Saves `next`. Property renames are always carried into the contact notes: a renamed property that is
   * left behind in the notes would no longer be synced, and Sync would delete its value on the server.
   * A rename that would overwrite a value in any note is refused as a whole: nothing is saved or renamed and the
   * draft goes back to the saved mapping. Otherwise, when notes are affected the owner confirms first; cancel keeps
   * the saved mapping.
   */
  const saveWithRenames = async (next: MappingRow[]) => {
    const renames = mappingRenames(saved.current, next);
    const blockers = renames.length > 0 ? renameBlockers(app, renames) : [];
    if (blockers.length > 0) {
      const targets = [...new Set(blockers.flatMap((b) => b.targets))];
      console.log(`Friendly Contacts: not renamed, ${targets.join(", ")} already has a value in:\n${blockers.map((b) => b.path).join("\n")}`);
      const n = blockers.length;
      new Notice(`Not renamed: ${n} ${n === 1 ? "note already has" : "notes already have"} ${targets.join(", ")}. See console.`);
      revert();
      return;
    }
    const count = renames.length > 0 ? notesToRename(app, renames).length : 0;
    if (count === 0) {
      await save(next);
      return;
    }
    const list = renames.map(({ from, to }) => `${from} to ${to}`).join(", ");
    new ConfirmModal(
      app,
      `Rename ${list} in ${count} contact notes?`,
      "Rename",
      async () => {
        await save(next);
        const { renamed, failed } = await renamePropertyInNotes(app, renames);
        if (failed.length > 0) console.log(`Friendly Contacts: could not rename in:\n${failed.join("\n")}`);
        new Notice(`Renamed ${list} in ${renamed} contact notes` + (failed.length > 0 ? `; ${failed.length} failed, see console` : ""));
      },
      "Cancel",
      revert,
    ).open();
  };

  const commit = async (next: MappingRow[]) => {
    setRows(next);
    const problems = validateMapping(next);
    setErrors(problems);
    if (problems.length > 0) return;
    await saveWithRenames(next);
  };

  const edit = (index: number, change: (row: MappingRow) => MappingRow) =>
    commit(rows.map((row, i) => (i === index ? change(row) : row)));

  /** Renames row `index`; mirrors naming it follow (unless the name is shared, then only this row changes). */
  const rename = (index: number, to: string) => {
    const from = rows[index].property;
    if (isFixedProperty(from)) return;
    if (index === current) setSelected(to);
    if (rows.filter((r) => r.property === from).length > 1) return edit(index, (r) => ({ ...r, property: to }));
    return commit(renameRow(rows, from, to));
  };

  /**
   * Restores the default property names; the dates with a label are the owner's own and stay. When one of them has
   * a name a default row takes back, nothing is saved and the errors show, as for an edit. Sync is on for every row;
   * a row that had Sync off gets `syncSince` as ticking it again does (see `syncSafeReset`).
   */
  const reset = async () => {
    const defaults = syncSafeReset(withLabelledDateRows(DEFAULT_MAPPING, saved.current), saved.current, Date.now());
    setRows(defaults);
    const problems = validateMapping(defaults);
    setErrors(problems);
    if (problems.length > 0) return;
    await saveWithRenames(defaults);
  };

  /** Saves `next` as it is (no renames) and shows it; a draft that was not saved is dropped. */
  const saveRows = async (next: MappingRow[]) => {
    await save(next);
    setRows(next);
    setErrors([]);
    setPartText({});
    setRevision((r) => r + 1);
  };

  /**
   * Adds a date with a label. The notes of contacts whose last-synced card holds such a date get the property first
   * (after a confirmation), so Sync never reads the date as removed in Obsidian; the row is only saved when every
   * note was filled. What is saved is built again from the mapping saved by then: a rename saved while the notes
   * were read or the confirmation was open is kept, not undone. The row is saved with the time it is added
   * (`since`): a sync base stored before then, on any device, is read without it (see `rowsForBase`).
   * A failure (reading the notes, filling, saving) is a notice, never an unhandled rejection.
   * Once the row is saved, the dates of every base this add considered (filled or not) are marked as up to date at
   * `since` or later (`datesAt`, see `touchBases`): on this device they agree with the row, so a note filled from a base is not read against the base without the row.
   * That is best effort: a failure is logged and a notice, and the add stays.
   */
  const addLabelledDate = async (label: string, property: string) => {
    const row = labelledDateRow(readableLabel(label), property);
    const first = mappingWithLabelledDate(saved.current, row);
    if ("errors" in first) {
      setErrors(first.errors);
      return;
    }
    setErrors([]);
    /** Saves the row on the mapping as saved now, then touches the bases; false (errors shown, nothing saved) when it no longer fits. */
    const saveAdded = async (notes: NoteWithBase[]): Promise<boolean> => {
      const since = Date.now();
      const now = mappingWithLabelledDate(saved.current, { ...row, since });
      if ("errors" in now) {
        setErrors(now.errors);
        new Notice(`Not added: the property names changed in the meantime, see the errors in the settings.`);
        return false;
      }
      await saveRows(now.rows);
      try {
        const { failed } = await touchBases(app, notes, since);
        if (failed.length > 0) new Notice(BASES_NOT_UPDATED);
      } catch (error) {
        console.error(`Friendly Contacts: could not update the sync bases after adding ${row.property}`, error);
        new Notice(BASES_NOT_UPDATED);
      }
      return true;
    };
    try {
      const notes = await notesWithBases(app);
      const fills = planDateFill(notes, first.rows, row, noteLinkOptions(getSettings().noteLinks).ownVaults);
      if (fills.length === 0) {
        await saveAdded(notes);
        return;
      }
      const n = fills.length;
      new ConfirmModal(
        app,
        `Add ${row.property} to ${n} contact notes, from their last Sync?`,
        "Add",
        () => {
          void (async () => {
            try {
              const { failed } = await fillNotes(app, fills);
              if (failed.length > 0) {
                console.log(`Friendly Contacts: ${row.property} not added, could not fill:\n${failed.join("\n")}`);
                new Notice(`Not added: ${failed.length} contact notes could not be filled, see console.`);
                return;
              }
              if (await saveAdded(notes)) new Notice(`Added ${row.property} to ${n} contact notes.`);
            } catch (error) {
              reportFailure("add", row.property, error);
            }
          })();
        },
        "Cancel",
      ).open();
    } catch (error) {
      reportFailure("add", row.property, error);
    }
  };

  /**
   * Removes the date with a label or the row of your own at `index` (in `rows`), and takes it out of the fields of
   * new contacts. Its lines stay on the cards; the property goes from the notes (after a confirmation), so a row added
   * again later never pushes leftover values as new.
   */
  const removeRow = async (index: number) => {
    const draft = rows[index];
    if (!draft || !isRemovableRow(draft)) return;
    const row = isLabelledDateRow(draft)
      ? saved.current.find((r) => isLabelledDateRow(r) && readableLabel(r.appleDateLabel).toLowerCase() === readableLabel(draft.appleDateLabel).toLowerCase())
      : saved.current.find((r) => r.property === draft.property && isRemovableRow(r));
    if (!row) return;
    const next = saved.current.filter((r) => r !== row);
    const saveRemoved = async () => {
      // Read with the row still saved, so a card field it reads (TEL[FAX]) counts too.
      const keys = getSettings().createFieldsKeys;
      const left = keys.filter((key) => newContactProperty(key, saved.current) !== row.property);
      await saveRows(next);
      if (left.length !== keys.length) await updateSetting("createFieldsKeys", left);
    };
    try {
      const n = notesWithRowProperties(app, row).length;
      if (n === 0) {
        await saveRemoved();
        return;
      }
      new ConfirmModal(
        app,
        `Remove ${row.property} from ${n} contact notes? ${isLabelledDateRow(row) ? "The dates stay" : "Its lines stay"} on the cards.`,
        "Remove",
        () => {
          void (async () => {
            try {
              await saveRemoved();
              const { removed, failed } = await removeRowProperties(app, row);
              if (failed.length > 0) console.log(`Friendly Contacts: could not remove ${row.property} from:\n${failed.join("\n")}`);
              new Notice(`Removed ${row.property} from ${removed} contact notes` + (failed.length > 0 ? `; ${failed.length} failed, see console` : ""));
            } catch (error) {
              reportFailure("remove", row.property, error);
            }
          })();
        },
        "Cancel",
      ).open();
    } catch (error) {
      reportFailure("remove", row.property, error);
    }
  };

  const named = rows.findIndex((row) => row.property === selected);
  const current = named >= 0 ? named : rows.length > 0 ? 0 : -1;
  const isOn = (row: MappingRow) => row.sync !== false || isFixedProperty(row.property);
  const setSync = (index: number, on: boolean) => { void commit(withSync(rows, index, on, Date.now())); };

  /** Name, uid and the name parts are always filled in on a new contact; why, for the details. */
  const names = nameProperties(rows);
  const alwaysInNew = (row: MappingRow): string | undefined =>
    row.property === "uid" ? "Always: every contact gets its own uid."
    : row.property === "name" || row.property === names.firstname || row.property === names.lastname ? "Always: filled in from the name you type."
    : undefined;
  const setInNew = (row: MappingRow, on: boolean) =>
    void updateSetting("createFieldsKeys", withNewContactProperty(getSettings().createFieldsKeys, row.property, on, rows));

  const show = (property: string) => {
    reveal.current = true;
    setSelected(property);
  };

  /**
   * Adds a row of your own for a whole card field (see `ownRow`) to the saved property names and shows it; with
   * `inNew` new contacts get it too. The error text when it cannot be added; nothing is saved then.
   */
  const addOwnRow = async (cardField: string, property: string, inNew: boolean): Promise<string | undefined> => {
    if (errors.length > 0) return "Fix the errors in the property names first.";
    const made = ownRow(cardField, property, saved.current, Date.now());
    if ("error" in made) return made.error;
    const next = [...saved.current, made.row];
    const problems = validateMapping(next);
    if (problems.length > 0) return problems.join(" ");
    const keys = getSettings().createFieldsKeys;
    await saveRows(next);
    if (inNew) await updateSetting("createFieldsKeys", withNewContactProperty(keys, made.row.property, true, next));
    show(made.row.property);
    return undefined;
  };

  /**
   * Gives new contacts what was typed: a property, the property that reads a card field, or (for a card field no row
   * reads) a new row of your own. The error text when nothing was added.
   */
  const addToNewContacts = async (typed: string): Promise<string | undefined> => {
    const keys = getSettings().createFieldsKeys;
    const wanted = newContactAddition(typed, keys, saved.current);
    if ("error" in wanted) return wanted.error;
    if ("cardField" in wanted) return addOwnRow(wanted.cardField, "", true);
    await updateSetting("createFieldsKeys", [...keys, wanted.property]);
    return undefined;
  };
  React.useEffect(() => {
    if (!reveal.current) return;
    reveal.current = false;
    layoutRef.current?.querySelector(".vcf-props-item.is-selected")?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  });

  const detail = (i: number) => {
    const row = rows[i];
    const fixed = isFixedProperty(row.property);
    return (
      <div className="vcf-props-detail" key={`${revision}-${i}`}>
        <div className="vcf-props-detail-title">{row.property}</div>
        <div className="setting-group">
          <div className="setting-items">
            <Field name="Name in note" description={fixed ? "This name cannot be changed." : "The property in your contact notes."}>
              {fixed ? (
                <span className="vcf-mapping-readonly">{row.property}</span>
              ) : (
                <CommitInput label="Property name" value={row.property} onCommit={(text) => rename(i, text.trim())} />
              )}
            </Field>
            {row.kind === "relation" ? (
              <>
                <Field name="Read from" description="The relationship types on cards.">
                  <span className="vcf-mapping-readonly">{row.types.join(", ")}</span>
                </Field>
                <Field name="Mirrored by" description="The property the other contact gets.">
                  <span className="vcf-mapping-readonly">{row.mirror ?? "none"}</span>
                </Field>
              </>
            ) : isLabelledDateRow(row) ? (
              <Field name="Read from" description="Dates with this label on the card.">
                <span className="vcf-mapping-readonly">{`label ${readableLabel(row.appleDateLabel)}`}</span>
              </Field>
            ) : (
              <>
                <Field name="Read from" description={<>Card fields, comma separated, e.g. <code>TEL[CELL], TEL[IPHONE,CELL]</code>. Changing it does not refill your notes.</>}>
                  <CommitInput
                    label={`Read patterns for ${row.property}`}
                    value={row.read.join(", ")}
                    onCommit={(text) => edit(i, (r) => ({ ...r, read: splitPatterns(text) }) as MappingRow)}
                  />
                </Field>
                {row.kind === "component" && (
                  <Field name="Part" description={<>Which part of the field, counting from 1: <code>ORG</code> part 2 is the department.</>}>
                    <CommitInput
                      label={`Part for ${row.property}`}
                      value={Number.isNaN(row.index) ? (partText[i] ?? "") : String(row.index + 1)}
                      onCommit={(text) => {
                        setPartText((typed) => ({ ...typed, [i]: text }));
                        return edit(i, (r) => ({ ...r, index: partIndex(text) }) as MappingRow);
                      }}
                    />
                  </Field>
                )}
              </>
            )}
            <Field name="Write as (vCard 4.0)" description="The field a new line gets on a vCard 4.0 card.">
              {row.kind === "relation" ? (
                <span className="vcf-mapping-readonly">RELATED;<wbr />{`TYPE=${row.types[0] ?? ""}`}</span>
              ) : isLabelledDateRow(row) ? (
                <span className="vcf-mapping-readonly">{keyWithLabel("X-ABDATE", row.appleDateLabel)}</span>
              ) : (
                <CommitInput
                  label={`Write key for ${row.property}`}
                  value={row.write}
                  onCommit={(text) => edit(i, (r) => ({ ...r, write: text.trim() }))}
                />
              )}
            </Field>
            <Field name="Write as (vCard 3.0)" description="The field a new line gets on a vCard 3.0 card; empty is the same as 4.0.">
              {row.kind === "relation" ? (
                <span className="vcf-mapping-readonly">{relationWriteV3(row)}</span>
              ) : row.kind === "field" && row.appleDateLabel !== undefined ? (
                <span className="vcf-mapping-readonly">{keyWithLabel("X-ABDATE", row.appleDateLabel)}</span>
              ) : fixed ? (
                <span className="vcf-mapping-readonly">{row.writeV3?.trim() || SAME_AS_4}</span>
              ) : (
                <CommitInput
                  label={`vCard 3.0 write key for ${row.property}`}
                  placeholder={SAME_AS_4}
                  value={row.writeV3 ?? ""}
                  onCommit={(text) => edit(i, (r) => withWriteV3(r, text.trim()))}
                />
              )}
            </Field>
            <Field
              name="In new contacts"
              description={alwaysInNew(row) ?? "A new contact gets this property, empty and ready to fill in."}
            >
              <Toggle
                on={alwaysInNew(row) !== undefined || inNewContacts(row.property, newContactKeys, rows)}
                label="In new contacts"
                disabled={alwaysInNew(row) !== undefined}
                onChange={(on) => setInNew(row, on)}
              />
            </Field>
            <Field name="Sync" description={fixed ? "uid, name and photo are always synced." : SYNC_OFF}>
              <Toggle on={isOn(row)} label="Sync" disabled={fixed} onChange={(on) => setSync(i, on)} />
            </Field>
            {isRemovableRow(row) && (
              <Field
                name="Remove"
                description={`Takes the property out of the list and out of your contact notes; ${isLabelledDateRow(row) ? "the dates stay" : "its lines stay"} on the cards.`}
              >
                <button className="mod-warning" onClick={() => void removeRow(i)}>Remove</button>
              </Field>
            )}
          </div>
        </div>
      </div>
    );
  };

  const item = (i: number) => {
    const row = rows[i];
    return (
      <React.Fragment key={`${revision}-${i}`}>
        <div
          className={`vcf-props-item${i === current ? " is-selected" : ""}${isOn(row) ? "" : " is-off"}`}
          role="listitem"
          aria-current={i === current}
          tabIndex={0}
          onClick={() => setSelected(row.property)}
          onKeyDown={(event) => {
            if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
              event.preventDefault();
              setSelected(row.property);
            }
          }}
        >
          <span className="vcf-props-item-name">{row.property}</span>
          <Toggle on={isOn(row)} label={`Sync ${row.property}`} disabled={isFixedProperty(row.property)} onChange={(on) => setSync(i, on)} />
        </div>
        {narrow && i === current && detail(i)}
      </React.Fragment>
    );
  };

  return (
    <>
      <div className="setting-item setting-item-heading">
        <div className="setting-item-info">
          <div className="setting-item-name">Property names</div>
          <div className="setting-item-description">
            The properties in your contact notes, and the card fields they are read from and written to. Pick one to
            see and change it; the switch turns Sync on or off. Add a property for any other card field below the list.
          </div>
        </div>
        <div className="setting-item-control">
          <button onClick={reset}>Reset to defaults</button>
        </div>
      </div>

      <div className="setting-item">
        <div className="setting-item-info">
          <div className="setting-item-name">Mirror relationships on this device</div>
          <div className="setting-item-description">
            Keeps both sides of a relationship in sync, e.g. children and parents. Takes effect after reloading the plugin.
          </div>
        </div>
        <div className="setting-item-control">
          <Toggle
            on={mirror}
            label="Mirror relationships on this device"
            onChange={(on) => {
              setMirrorRelationsOnThisDevice(app, on);
              setMirror(on);
            }}
          />
        </div>
      </div>

      {errors.length > 0 && (
        <div className="vcf-mapping-errors mod-warning">
          {errors.map((error) => <div key={error}>{error}</div>)}
          <div>The property names are not saved until these are fixed.</div>
        </div>
      )}

      <div className="vcf-props" ref={layoutRef}>
        <div className={`vcf-props-layout${narrow ? " is-narrow" : ""}`}>
          <div className="vcf-props-list" role="list" aria-label="Properties">
            {groupRows(rows, () => true).map(({ group, indexes }) => (
              <React.Fragment key={group}>
                <div className="vcf-props-group">{group}</div>
                {indexes.map(item)}
              </React.Fragment>
            ))}
          </div>
          {!narrow && current >= 0 && detail(current)}
        </div>
      </div>

      <AddPropertyLine onAdd={(cardField, property) => addOwnRow(cardField, property, false)} />

      <DateLabelsSettings app={app} rows={rows} onAdd={addLabelledDate} />

      <NewContactsSettings
        rows={rows}
        onSelect={show}
        onAdd={addToNewContacts}
        onMakeProperty={(key) => addOwnRow(key, "", false)}
      />
    </>
  );
}
