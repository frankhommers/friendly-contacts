import { App, Notice } from "obsidian";
import * as React from "react";
import { DEFAULT_MAPPING, MappingRow, validateMapping } from "src/contacts/friendly/mapping";
import { notesToRename, renamePropertyInNotes } from "src/contacts/obsidianNotes";
import { getSettings, setSettings, updateSetting } from "src/context/sharedSettingsContext";
import { ConfirmModal } from "src/ui/modals/confirmModal";

/** A text input that keeps what is typed locally and hands it over when it loses focus. */
function CommitInput({ value, onCommit, label }: { value: string; onCommit: (text: string) => void; label: string }) {
  const [text, setText] = React.useState(value);
  React.useEffect(() => setText(value), [value]);
  return (
    <input
      type="text"
      aria-label={label}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onCommit(text)}
    />
  );
}

const splitPatterns = (text: string): string[] =>
  text.split(",").map((p) => p.trim()).filter((p) => p !== "");

export function PropertyNamesSettings({ app }: { app: App }) {
  const [rows, setRows] = React.useState<MappingRow[]>(() => getSettings().friendly.mapping);
  const saved = React.useRef<MappingRow[]>(rows);
  const [errors, setErrors] = React.useState<string[]>([]);
  const [mirror, setMirror] = React.useState(getSettings().friendly.mirrorRelations);

  const save = async (mapping: MappingRow[]) => {
    const current = getSettings();
    await setSettings({ ...current, friendly: { ...current.friendly, mapping } });
    saved.current = mapping;
  };

  const offerRenames = (before: MappingRow[], after: MappingRow[]) => {
    after.forEach((row, i) => {
      const from = before[i]?.property;
      if (from === undefined || from === row.property) return;
      const count = notesToRename(app, from, row.property).length;
      if (count === 0) return;
      new ConfirmModal(app, `Rename property ${from} to ${row.property} in ${count} contact notes?`, "Rename", async () => {
        const { renamed, skipped } = await renamePropertyInNotes(app, from, row.property);
        if (skipped.length > 0) console.log(`Friendly Contacts: not renamed, ${row.property} already has a value:\n${skipped.join("\n")}`);
        new Notice(`Renamed ${from} to ${row.property} in ${renamed} contact notes` + (skipped.length > 0 ? `; ${skipped.length} skipped, see console` : ""));
      }).open();
    });
  };

  const commit = async (next: MappingRow[]) => {
    setRows(next);
    const problems = validateMapping(next);
    setErrors(problems);
    if (problems.length > 0) return;
    const before = saved.current;
    await save(next);
    offerRenames(before, next);
  };

  const edit = (index: number, change: (row: MappingRow) => MappingRow) =>
    commit(rows.map((row, i) => (i === index ? change(row) : row)));

  const reset = async () => {
    setRows(DEFAULT_MAPPING);
    setErrors([]);
    await save(DEFAULT_MAPPING);
  };

  return (
    <>
      <div className="setting-item setting-item-heading">
        <div className="setting-item-info">
          <div className="setting-item-name">Property names</div>
          <div className="setting-item-description">
            The names of the properties in your contact notes, and the vCard fields they are read from and written to.
            Read patterns are comma separated, e.g. <code>TEL[CELL], TEL[IPHONE,CELL]</code>.
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
            onClick={async () => {
              setMirror(!mirror);
              await updateSetting("friendly.mirrorRelations", !mirror);
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
            <th>Name</th>
            <th>Read from</th>
            <th>Write as</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td>
                <CommitInput
                  label="Property name"
                  value={row.property}
                  onCommit={(text) => edit(i, (r) => ({ ...r, property: text.trim() }))}
                />
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
              <td>
                <CommitInput
                  label={`Write key for ${row.property}`}
                  value={row.write}
                  onCommit={(text) => edit(i, (r) => ({ ...r, write: text.trim() }))}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
