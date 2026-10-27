import * as React from "react";
import { isFixedProperty, MappingRow } from "src/contacts/friendly/mapping";
import { updateSetting } from "src/context/sharedSettingsContext";
import { DEFAULT_SETTINGS } from "src/settings/setting";
import { inNewContacts, newContactProperty, otherNewContactKeys, parseNewContactKey } from "src/settings/newContactFields";
import { useSettings } from "src/ui/hooks/settingsHook";
import { Icon } from "src/ui/sidebar/components/elements/Icon";

export interface NewContactsSettingsProps {
  /** The property names as shown in the list (the draft). */
  rows: MappingRow[];
  /** True for a row shown in the property list. */
  listed: (row: MappingRow) => boolean;
  /** Shows a property in the list. */
  onSelect: (property: string) => void;
}

/**
 * "New contacts": the fields a new contact gets (`createFieldsKeys`). Properties in the list are switched on and off
 * in their details and only shown here; any other field (a card field without a property, a date with a label) is
 * added and removed here.
 */
export function NewContactsSettings({ rows, listed, onSelect }: NewContactsSettingsProps) {
  const keys = useSettings()?.createFieldsKeys ?? [];
  const [text, setText] = React.useState("");
  const [error, setError] = React.useState<string | undefined>(undefined);

  const shown = rows.filter((row) => listed(row) && !isFixedProperty(row.property) && inNewContacts(row.property, keys, rows));
  const others = otherNewContactKeys(keys, rows, listed);

  const add = () => {
    const parsed = parseNewContactKey(text, keys, rows);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    setError(undefined);
    setText("");
    void updateSetting("createFieldsKeys", [...keys, parsed.key]);
  };

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
            return (
              <div className="setting-item" key={key}>
                <div className="setting-item-info">
                  <div className="setting-item-name">{key}</div>
                  <div className="setting-item-description">
                    {property === key ? "Created as it is." : `Created as ${property}.`}
                  </div>
                </div>
                <div className="setting-item-control">
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
                A property name, or a card field such as <code>NOTE</code> or <code>X-SKYPE</code>.
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
                    add();
                  }
                }}
              />
              <button onClick={add}>Add field</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
