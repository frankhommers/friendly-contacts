import * as React from "react";

/** Obsidian's on/off switch. A disabled switch shows its state and cannot be changed. */
export function Toggle({
  on,
  onChange,
  label,
  disabled = false,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  const flip = (event: React.SyntheticEvent) => {
    event.stopPropagation();
    if (!disabled) onChange(!on);
  };
  return (
    <div
      className={`checkbox-container${on ? " is-enabled" : ""}${disabled ? " is-disabled" : ""}`}
      role="switch"
      aria-label={label}
      aria-checked={on}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onClick={flip}
      onKeyDown={(event) => {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          flip(event);
        }
      }}
    >
      <input type="checkbox" tabIndex={-1} checked={on} disabled={disabled} readOnly />
    </div>
  );
}
