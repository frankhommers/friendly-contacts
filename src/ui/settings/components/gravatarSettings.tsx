import * as React from "react";
import { updateSetting } from "src/context/sharedSettingsContext";
import { GRAVATAR_FALLBACK_LABELS, GRAVATAR_FALLBACKS, GravatarFallback } from "src/ui/avatar/gravatar";
import { useSettings } from "src/ui/hooks/settingsHook";
import { Toggle } from "src/ui/settings/components/toggle";

/** "Contact cards": Gravatar for contacts without a photo, and what to show when there is no Gravatar either. */
export function GravatarSettings() {
  const gravatar = useSettings()?.gravatar;
  if (!gravatar) return null;
  return (
    <div className="vcf-gravatar-settings">
      <div className="setting-item setting-item-heading">
        <div className="setting-item-info">
          <div className="setting-item-name">Contact cards</div>
        </div>
      </div>
      <div className="setting-item">
        <div className="setting-item-info">
          <div className="setting-item-name">Gravatar</div>
          <div className="setting-item-description">
            Shows the Gravatar of the first email address on the card of a contact without a photo. Only shown, never
            saved in the note or on the card. Gravatar receives a hash of the email address of every contact you open.
          </div>
        </div>
        <div className="setting-item-control">
          <Toggle label="Gravatar" on={gravatar.enabled} onChange={(on) => void updateSetting("gravatar.enabled", on)} />
        </div>
      </div>
      <div className="setting-item">
        <div className="setting-item-info">
          <div className="setting-item-name">Without a Gravatar</div>
          <div className="setting-item-description">
            What the card shows when the contact has no Gravatar: its initials, or an image Gravatar makes from the
            email address.
          </div>
        </div>
        <div className="setting-item-control">
          <select
            className="dropdown"
            aria-label="Without a Gravatar"
            value={gravatar.fallback}
            disabled={!gravatar.enabled}
            onChange={(event) => void updateSetting("gravatar.fallback", event.target.value as GravatarFallback)}
          >
            {GRAVATAR_FALLBACKS.map((fallback) => (
              <option key={fallback} value={fallback}>
                {GRAVATAR_FALLBACK_LABELS[fallback]}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
