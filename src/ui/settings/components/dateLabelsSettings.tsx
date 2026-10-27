import { App, Notice } from "obsidian";
import * as React from "react";
import { isLabelledDateRow, readableLabel, suggestPropertyName } from "src/contacts/friendly/dateLabels";
import { MappingRow } from "src/contacts/friendly/mapping";
import { findDateLabels } from "src/contacts/labelledDates";

export interface DateLabelsSettingsProps {
  app: App;
  rows: MappingRow[];
  onAdd(label: string, property: string): Promise<void>;
}

const sameLabel = (a: string, b: string): boolean => readableLabel(a).toLowerCase() === readableLabel(b).toLowerCase();

/**
 * "Dates with a label": an add line and the labels found on the cards; the dates themselves are in the property list. Every change goes through the callbacks, so the mapping is saved in one place (`PropertyNamesSettings`).
 */
export function DateLabelsSettings({ app, rows, onAdd }: DateLabelsSettingsProps) {
  const [label, setLabel] = React.useState("");
  const [property, setProperty] = React.useState("");
  const propertyInput = React.useRef<HTMLInputElement>(null);
  /** The label of the last Add: the add line is cleared once a row with that label shows up. */
  const added = React.useRef<string | null>(null);
  /**
   * True while an Add reads the notes and their bases (until the confirmation opens or the row is saved). The ref
   * guards (a second Enter before the re-render is ignored); the state disables the button.
   */
  const addingRef = React.useRef(false);
  const [adding, setAdding] = React.useState(false);
  const [found, setFound] = React.useState<{ labels?: { label: string; contacts: number }[]; finding?: boolean; error?: string }>();

  React.useEffect(() => {
    const pending = added.current;
    if (pending === null) return;
    if (rows.some((row) => isLabelledDateRow(row) && sameLabel(row.appleDateLabel, pending))) {
      added.current = null;
      setLabel("");
      setProperty("");
    }
  }, [rows]);


  const add = async () => {
    if (addingRef.current) return;
    addingRef.current = true;
    added.current = label;
    setAdding(true);
    try {
      await onAdd(label, property);
    } catch (error) {
      const name = property.trim();
      console.error(`Friendly Contacts: could not add ${name}`, error);
      new Notice(`Could not add ${name}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  };

  const find = async () => {
    setFound({ finding: true });
    try {
      setFound({ labels: await findDateLabels(app, rows) });
    } catch (error) {
      setFound({ error: error instanceof Error ? error.message : String(error) });
    }
  };

  /** Puts a found label in the add line; the owner gives it an English property name before anything is written. */
  const pick = (picked: string) => {
    setLabel(picked);
    setProperty(suggestPropertyName(picked));
    propertyInput.current?.focus();
  };

  // A found label that got a row since is no longer offered.
  const labels = found?.labels?.filter(
    (f) => !rows.some((row) => row.kind === "field" && row.appleDateLabel !== undefined && sameLabel(row.appleDateLabel, f.label)),
  );
  const foundText = (): string | undefined => {
    if (found?.finding) return "Reading the cards…";
    if (found?.error !== undefined) return `Could not read the cards: ${found.error}`;
    if (labels && labels.length === 0) return "No other labels on the cards of your contacts.";
    return undefined;
  };

  return (
    <>
      <div className="setting-item setting-item-heading">
        <div className="setting-item-info">
          <div className="setting-item-name">Dates with a label</div>
          <div className="setting-item-description">
            Dates a phone keeps under a label of its own, such as "Verkering". Give each label a property for your
            notes, in English, e.g. dating; change or remove it in its details in the list.
          </div>
        </div>
      </div>

      <div className="setting-item">
        <div className="setting-item-info">
          <div className="setting-item-name">Add a date with a label</div>
          <div className="setting-item-description">
            The label as it is on the card, and a property for your notes. It then shows in the list under Dates.
          </div>
        </div>
        <div className="setting-item-control">
          <input type="text" aria-label="Label" placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
          <input
            ref={propertyInput}
            type="text"
            aria-label="Property"
            placeholder="Property"
            value={property}
            onChange={(e) => setProperty(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
          />
          <button disabled={adding} onClick={() => { void add(); }}>Add</button>
        </div>
      </div>

      <div className="setting-item">
        <div className="setting-item-info">
          <div className="setting-item-name">Labels on the cards</div>
          <div className="setting-item-description">
            Reads the cards as they were at each contact's last Sync.
            {foundText() !== undefined
              ? <div className={found?.error !== undefined ? "mod-warning" : undefined}>{foundText()}</div>
              : null}
          </div>
        </div>
        <div className="setting-item-control">
          <button disabled={found?.finding === true} onClick={() => { void find(); }}>
            Find labels on cards
          </button>
        </div>
      </div>

      {labels?.map((f) => (
        <div className="setting-item" key={f.label}>
          <div className="setting-item-info">
            <div className="setting-item-name">{`${f.label} — on ${f.contacts} ${f.contacts === 1 ? "contact" : "contacts"}`}</div>
          </div>
          <div className="setting-item-control">
            <button onClick={() => pick(f.label)}>Add</button>
          </div>
        </div>
      ))}
    </>
  );
}
