import * as React from "react";
import { isFixedProperty, isMappedProperty, MappingRow } from "src/contacts/friendly/mapping";
import { updateSetting } from "src/context/sharedSettingsContext";
import { DEFAULT_SETTINGS } from "src/settings/setting";
import { inNewContacts, newContactProperty, otherNewContactKeys } from "src/settings/newContactFields";
import { useSettings } from "src/ui/hooks/settingsHook";
import { Icon } from "src/ui/sidebar/components/elements/Icon";

export interface NewContactsSettingsProps {
  /** The property names as shown in the list (the draft). */
  rows: MappingRow[];
  /** Shows a property in the list. */
  onSelect: (property: string) => void;
  /** Gives new contacts what was typed (a property or a card field); the error text when nothing was added. */
  onAdd: (typed: string) => Promise<string | undefined>;
  /** Makes a property for a card field no property reads; the error text when it was not made. */
  onMakeProperty: (cardField: string) => Promise<string | undefined>;
}

/**
 * "New contacts": the fields a new contact gets (`createFieldsKeys`). Properties are switched on and off in their
 * details and shown here as links. Adding a card field no property reads makes a property for it. An entry no
 * property reads (stored by an earlier version, e.g. `X-FOO`) is listed on its own: it is never synced until it
 * gets a property.
 */
export function NewContactsSettings({ rows, onSelect, onAdd, onMakeProperty }: NewContactsSettingsProps) {
  const keys = useSettings()?.createFieldsKeys ?? [];
  const [text, setText] = React.useState("");
  const [error, setError] = React.useState<string | undefined>(undefined);

  const shown = rows.filter((row) => !isFixedProperty(row.property) && inNewContacts(row.property, keys, rows));
  const others = otherNewContactKeys(keys, rows);

  const add = async () => {
    const problem = await onAdd(text);
    setError(problem);
    if (problem === undefined) setText("");
  };
  const makeProperty = async (key: string) => setError(await onMakeProperty(key));

  const remove = (key: string) => void updateSetting("createFieldsKeys", keys.filter((k) => k !== key));

  return (
    <div className="vcf-new-contacts">
      <div className="setting-item setting-item-heading">
        <div className="setting-item-info">
          <div className="setting-item-name">New contacts</div>
          <div className="setting-item-description">
            The fields a new contact gets, empty and ready to fill in, besides its name and uid. The command{" "}
            <em>Apply Default Fields to Current File</em> adds the missing ones to an existing contact.
          </div>
        </div>
        <div className="setting-item-control">
          <button onClick={() => void updateSetting("createFieldsKeys", [...DEFAULT_SETTINGS.createFieldsKeys])}>
            Reset to defaults
          </button>
        </div>
      </div>
      <div className="setting-group">
        <div className="setting-items">
          <div className="setting-item">
            <div className="setting-item-info">
              <div className="setting-item-name">Properties</div>
              <div className="setting-item-description">
                Switch a property on or off with <em>In new contacts</em> in its details above.
              </div>
              <div className="vcf-new-contacts-properties" aria-label="Properties in new contacts">
                {shown.length === 0
                  ? "None"
                  : shown.map((row, i) => (
                      <React.Fragment key={row.property}>
                        {i > 0 && ", "}
                        <a
                          className="vcf-link"
                          role="button"
                          tabIndex={0}
                          onClick={() => onSelect(row.property)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              onSelect(row.property);
                            }
                          }}
                        >
                          {row.property}
                        </a>
                      </React.Fragment>
                    ))}
              </div>
            </div>
          </div>
          {others.map((key) => {
            const property = newContactProperty(key, rows);
            const unread = property === key && !isMappedProperty(key, rows);
            return (
              <div className="setting-item" key={key}>
                <div className="setting-item-info">
                  <div className="setting-item-name">{key}</div>
                  <div className="setting-item-description">
                    {unread
                      ? "Created as it is, and never synced: no property reads it. Make it a property to sync it."
                      : property === key ? "Created as it is." : `Created as ${property}.`}
                  </div>
                </div>
                <div className="setting-item-control">
                  {unread && <button onClick={() => void makeProperty(key)}>Make property</button>}
                  <div
                    className="clickable-icon extra-setting-button"
                    role="button"
                    tabIndex={0}
                    aria-label={`Remove ${key}`}
                    onClick={() => remove(key)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        remove(key);
                      }
                    }}
                  >
                    <Icon name="trash-2" />
                  </div>
                </div>
              </div>
            );
          })}
          <div className="setting-item">
            <div className="setting-item-info">
              <div className="setting-item-name">Add a field</div>
              <div className="setting-item-description">
                A property name, or a card field such as <code>NOTE</code> or <code>X-BANAAN</code>. A card field no
                property reads yet gets a property of its own, with all its settings in the list.
              </div>
              {error && <div className="setting-item-description mod-warning">{error}</div>}
            </div>
            <div className="setting-item-control">
              <input
                type="text"
                aria-label="Field for new contacts"
                placeholder="Property or card field"
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void add();
                  }
                }}
              />
              <button onClick={() => void add()}>Add field</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
