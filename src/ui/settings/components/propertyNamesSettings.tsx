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
import { DEFAULT_MAPPING, isFixedProperty, mappingRenames, MappingRow, RelationRow, renameRow, syncSafeReset, validateMapping, withSync } from "src/contacts/friendly/mapping";
import { noteLinkOptions } from "src/contacts/friendly/noteLinks";
import { fillNotes, NoteWithBase, notesWithBases, notesWithRowProperties, removeRowProperties, touchBases } from "src/contacts/labelledDates";
import { notesToRename, renameBlockers, renamePropertyInNotes } from "src/contacts/obsidianNotes";
import { getSettings, setSettings } from "src/context/sharedSettingsContext";
import { mirrorRelationsOnThisDevice, setMirrorRelationsOnThisDevice } from "src/settings/deviceSettings";
import { ConfirmModal } from "src/ui/modals/confirmModal";
import { CommitInput } from "src/ui/settings/components/commitInput";
import { DateLabelsSettings } from "src/ui/settings/components/dateLabelsSettings";

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

/** What a relation is written as on a vCard 3.0 card: the label on `X-ABRELATEDNAMES`, or the 4.0 form without one. */
/** A vCard key with a label, e.g. `X-ABRELATEDNAMES · label Friend`; the key never breaks over two lines. */
const keyWithLabel = (key: string, label: string) => (
  <><span className="vcf-mapping-key">{key}</span>{` · label ${label}`}</>
);

const relationWriteV3 = (row: RelationRow): React.ReactNode => {
  const label = (row.labels ?? [])[0]?.trim() ?? "";
  return label === "" ? SAME_AS_4 : keyWithLabel("X-ABRELATEDNAMES", label);
};

const BASES_NOT_UPDATED = "Some sync bases could not be updated; see console.";

export function PropertyNamesSettings({ app }: { app: App }) {
  const [rows, setRows] = React.useState<MappingRow[]>(() => getSettings().friendly.mapping);
  const saved = React.useRef<MappingRow[]>(rows);
  const [errors, setErrors] = React.useState<string[]>([]);
  /** Bumped by `revert`: the inputs are remounted so they show the saved values even when `rows` did not change. */
  const [revision, setRevision] = React.useState(0);
  const [mirror, setMirror] = React.useState(() => mirrorRelationsOnThisDevice(app));
  /** The Part text typed per row; shown while the row's part is invalid (NaN), so the input never reads "NaN". */
  const [partText, setPartText] = React.useState<Record<number, string>>({});

  const save = async (mapping: MappingRow[]) => {
    const current = getSettings();
    await setSettings({ ...current, friendly: { ...current.friendly, mapping } });
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
   * Removes the date with a label at `index` (in `rows`). The dates stay on the cards; the property goes from the
   * notes (after a confirmation), so a row added again later never pushes leftover values as new dates.
   */
  const removeLabelledDate = async (index: number) => {
    const draft = rows[index];
    if (!isLabelledDateRow(draft)) return;
    const label = readableLabel(draft.appleDateLabel).toLowerCase();
    const row = saved.current.find((r) => isLabelledDateRow(r) && readableLabel(r.appleDateLabel).toLowerCase() === label);
    if (!row) return;
    const next = saved.current.filter((r) => r !== row);
    try {
      const n = notesWithRowProperties(app, row).length;
      if (n === 0) {
        await saveRows(next);
        return;
      }
      new ConfirmModal(
        app,
        `Remove ${row.property} from ${n} contact notes? The dates stay on the cards.`,
        "Remove",
        () => {
          void (async () => {
            try {
              await saveRows(next);
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

  return (
    <>
      <div className="setting-item setting-item-heading">
        <div className="setting-item-info">
          <div className="setting-item-name">Property names</div>
          <div className="setting-item-description">
            The names of the properties in your contact notes, and the vCard fields they are read from and written to.
            Read patterns are comma separated, e.g. <code>TEL[CELL], TEL[IPHONE,CELL]</code>.
            Part picks one part of a field made of parts (<code>ORG</code> part 2 is the department).
            The vCard 3.0 column is used for new fields on vCard 3.0 cards; empty means the same as 4.0.
            Changing Read from or Part does not refill your notes.
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
          <div
            className={`checkbox-container${mirror ? " is-enabled" : ""}`}
            role="switch"
            aria-checked={mirror}
            tabIndex={0}
            onClick={() => {
              setMirrorRelationsOnThisDevice(app, !mirror);
              setMirror(!mirror);
            }}
          >
            <input type="checkbox" tabIndex={0} checked={mirror} readOnly />
          </div>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="vcf-mapping-errors mod-warning">
          {errors.map((error) => <div key={error}>{error}</div>)}
          <div>The property names are not saved until these are fixed.</div>
        </div>
      )}

      <table className="vcf-mapping-table">
        <thead>
          <tr>
            <th className="vcf-mapping-name">Name</th>
            <th>Read from</th>
            <th className="vcf-mapping-part">Part</th>
            <th>Write as (vCard 4.0)</th>
            <th>Write as (vCard 3.0)</th>
            <th className="vcf-mapping-sync">Sync</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => isLabelledDateRow(row) ? null : (
            <tr key={`${revision}-${i}`}>
              <td className="vcf-mapping-name">
                {isFixedProperty(row.property) ? (
                  <span className="vcf-mapping-readonly" title="This name cannot be changed">{row.property}</span>
                ) : (
                  <CommitInput
                    label="Property name"
                    value={row.property}
                    onCommit={(text) => rename(i, text.trim())}
                  />
                )}
              </td>
              <td>
                {row.kind === "relation" ? (
                  <span className="vcf-mapping-readonly">
                    {row.types.join(", ")}
                    {row.mirror !== undefined ? ` (mirrored by ${row.mirror})` : ""}
                  </span>
                ) : (
                  <CommitInput
                    label={`Read patterns for ${row.property}`}
                    value={row.read.join(", ")}
                    onCommit={(text) => edit(i, (r) => ({ ...r, read: splitPatterns(text) }) as MappingRow)}
                  />
                )}
              </td>
              <td className="vcf-mapping-part">
                {row.kind === "component" && (
                  <CommitInput
                    label={`Part for ${row.property}`}
                    value={Number.isNaN(row.index) ? (partText[i] ?? "") : String(row.index + 1)}
                    onCommit={(text) => {
                      setPartText((typed) => ({ ...typed, [i]: text }));
                      return edit(i, (r) => ({ ...r, index: partIndex(text) }) as MappingRow);
                    }}
                  />
                )}
              </td>
              <td>
                {row.kind === "relation" ? (
                  <span className="vcf-mapping-readonly">RELATED;<wbr />{`TYPE=${row.types[0] ?? ""}`}</span>
                ) : (
                  <CommitInput
                    label={`Write key for ${row.property}`}
                    value={row.write}
                    onCommit={(text) => edit(i, (r) => ({ ...r, write: text.trim() }))}
                  />
                )}
              </td>
              <td>
                {row.kind === "relation" ? (
                  <span className="vcf-mapping-readonly">{relationWriteV3(row)}</span>
                ) : row.kind === "field" && row.appleDateLabel !== undefined ? (
                  <span className="vcf-mapping-readonly">{keyWithLabel("X-ABDATE", row.appleDateLabel)}</span>
                ) : isFixedProperty(row.property) ? (
                  <span className="vcf-mapping-readonly">{row.writeV3?.trim() || SAME_AS_4}</span>
                ) : (
                  <CommitInput
                    label={`vCard 3.0 write key for ${row.property}`}
                    placeholder={SAME_AS_4}
                    value={row.writeV3 ?? ""}
                    onCommit={(text) => edit(i, (r) => withWriteV3(r, text.trim()))}
                  />
                )}
              </td>
              <td className="vcf-mapping-sync">
                <input
                  type="checkbox"
                  aria-label={`Sync ${row.property}`}
                  checked={row.sync !== false || isFixedProperty(row.property)}
                  disabled={isFixedProperty(row.property)}
                  onChange={(e) => { void commit(withSync(rows, i, e.target.checked, Date.now())); }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="setting-item-description">
        Sync off: the property stays in your notes, but Sync and Import no longer read it from cards or write it to them.
        Lines already on a card stay there; remove them yourself if you want them gone.
      </div>

      <DateLabelsSettings
        app={app}
        rows={rows}
        revision={revision}
        onRename={(index, to) => { void rename(index, to); }}
        onAdd={addLabelledDate}
        onRemove={(index) => { void removeLabelledDate(index); }}
      />
    </>
  );
}
