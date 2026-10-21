import * as React from "react";

/** A text input that keeps what is typed locally and hands it over when it loses focus. */
export function CommitInput({ value, onCommit, label }: { value: string; onCommit: (text: string) => void; label: string }) {
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
