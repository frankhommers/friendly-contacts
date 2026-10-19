import { App, Modal, Notice } from 'obsidian';
import * as React from 'react';
import { useMemo, useState } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { canApply, Choice, isDecided, ReviewRow, Side, undecidedCount } from 'src/sync/review';
import {
  applyHint,
  cellValue,
  displayValue,
  DisplayValue,
  isMultiline,
  linkDisplayName,
  NONE,
  pickSides,
  shownRows,
  sideLabel,
  willRemove,
} from 'src/sync/reviewDisplay';
import type { PreparedSync } from 'src/sync/syncContact';

export interface SyncReviewInput {
  title: string;
  /** The "card moves from ... to ..." line of a source change. */
  moveLine?: string;
  /** The address book whose card the server column shows (its column, pick buttons and "All from" use the name). */
  serverName: string;
  /** Warning lines above the table. */
  warnings: string[];
  prepared: PreparedSync;
  /** Mirror writes the result of these choices will trigger on other notes, worded ("Sem: parents gets [[Jan]]"). */
  also: (choices: Map<string, Choice>) => string[];
  /** The result of these choices renames the note to `to`; `blocked` is the reason it cannot be. */
  rename: (choices: Map<string, Choice>) => { to: string; blocked?: string } | undefined;
  /** Relation targets of this row that exist only on the server; `import` makes them a note. */
  serverOnly: (row: ReviewRow) => { name: string; import(): Promise<void> }[];
  /** Called after an Import: the modal has closed and the caller should prepare and open the review again. */
  onReopen?: () => void;
  /** Called when the modal closes without Apply or Import (Cancel, Escape). */
  onCancel?: () => void;
}

const Value: React.FC<{ value: DisplayValue }> = ({ value }) => {
  if (value.image) return <img className="friendly-review-photo" src={value.image} alt="Photo" />;
  if (value.items) {
    return (
      <ul className="friendly-review-items">
        {value.items.map((item, i) => (
          <li key={i} className={item.only ? 'is-only' : undefined}>
            {item.name}
            {item.only ? <span className="friendly-review-only"> (only here)</span> : null}
          </li>
        ))}
      </ul>
    );
  }
  const classes = ['friendly-review-text'];
  if (value.muted || value.text === NONE) classes.push('friendly-review-none');
  return <span className={classes.join(' ')}>{value.text}</span>;
};

interface ContentProps {
  input: SyncReviewInput;
  linkName: (link: string) => string;
  onApply: (choices: Map<string, Choice>, rename: boolean) => void;
  onCancel: () => void;
  onImported: () => void;
}

const SyncReviewContent: React.FC<ContentProps> = ({ input, linkName, onApply, onCancel, onImported }) => {
  const rows = input.prepared.rows;
  const { serverName } = input;
  // A new card has no server side to pick: choosing it would empty the note.
  const newCard = input.prepared.server === undefined;
  const sides = pickSides(newCard);
  const [choices, setChoices] = useState<Map<string, Choice>>(new Map());
  const [showAll, setShowAll] = useState(false);
  const [rename, setRename] = useState(true);
  const [importing, setImporting] = useState(false);

  const effective = (row: ReviewRow): Choice | undefined => choices.get(row.property) ?? row.preselect;
  const set = (updates: [string, Choice][]) => {
    const next = new Map(choices);
    for (const [property, choice] of updates) next.set(property, choice);
    setChoices(next);
  };
  const setAll = (side: Side) => set(rows.filter((r) => r.changed).map((r) => [r.property, side]));

  const { visible, hidden: hiddenCount } = shownRows(rows, showAll);
  const ok = canApply(rows, choices) && !importing;
  const hint = applyHint(undecidedCount(rows, choices));
  // Both follow the current picks.
  const also = useMemo(() => input.also(choices), [input, choices]);
  const renameTo = useMemo(() => input.rename(choices), [input, choices]);
  const canRename = !!renameTo && !renameTo.blocked;
  const serverOnly = useMemo(
    () => new Map(rows.map((row) => [row.property, row.changed ? input.serverOnly(row) : []])),
    [input, rows],
  );

  const resultOf = (row: ReviewRow): DisplayValue | undefined => {
    const choice = effective(row);
    if (choice === undefined || !isDecided(row, choice)) return undefined;
    if (typeof choice === 'object') return { text: choice.custom.trim() === '' ? NONE : choice.custom };
    return displayValue(row, choice, linkName);
  };

  const runImport = async (entry: { import(): Promise<void> }) => {
    setImporting(true);
    try {
      await entry.import();
    } catch (e) {
      new Notice(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
      setImporting(false);
      return;
    }
    onImported();
  };

  const renderRow = (row: ReviewRow) => {
    const choice = effective(row);
    const conflict = !isDecided(row, choice);
    const classes = ['friendly-review-row'];
    if (!row.changed) classes.push('is-unchanged');
    if (conflict) classes.push('is-conflict');
    const result = resultOf(row);
    const entries = serverOnly.get(row.property) ?? [];
    const custom = typeof choice === 'object' ? choice.custom : undefined;
    const editText = custom ?? (result?.text !== undefined && result.text !== NONE ? result.text : '');
    const editProps = {
      className: 'friendly-review-edit',
      'aria-label': `Custom value for ${row.property}`,
      placeholder: 'Edit result',
      value: editText,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set([[row.property, { custom: e.target.value }]]),
    };

    return (
      <tr key={row.property} className={classes.join(' ')}>
        <th scope="row" className="friendly-review-property">
          {row.property}
          {conflict ? <span className="friendly-review-conflict"> Conflict: choose one</span> : null}
        </th>
        <td className={choice === 'server' ? 'is-chosen' : undefined}>
          <Value value={cellValue(row, 'server', linkName, { newCardIn: newCard ? serverName : undefined })} />
          {entries.map((entry, i) => (
            <div key={i} className="friendly-review-import">
              {entry.name} is not in Obsidian yet.{' '}
              <button disabled={importing} onClick={() => void runImport(entry)}>
                Import
              </button>
            </div>
          ))}
        </td>
        <td className={choice === 'local' ? 'is-chosen' : undefined}>
          <Value value={displayValue(row, 'local', linkName)} />
        </td>
        <td className="friendly-review-result">
          {row.changed ? (
            <>
              <div className="friendly-review-pick" role="radiogroup" aria-label={`${row.property} result`}>
                {sides.map((side) => (
                  <button
                    key={side}
                    role="radio"
                    aria-checked={choice === side}
                    className={choice === side ? 'is-selected mod-cta' : undefined}
                    onClick={() => set([[row.property, side]])}
                  >
                    {sideLabel(side, serverName)}
                  </button>
                ))}
              </div>
              {row.kind === 'text' ? (
                <>
                  {isMultiline(row, choice) ? <textarea rows={3} {...editProps} /> : <input type="text" {...editProps} />}
                  {willRemove(row, choice) ? <span className="friendly-review-removed">(will be removed)</span> : null}
                </>
              ) : result ? (
                <Value value={{ ...result, items: result.items?.map((i) => ({ ...i, only: false })) }} />
              ) : null}
            </>
          ) : (
            <Value value={displayValue(row, 'server', linkName)} />
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="friendly-review">
      {input.warnings.map((warning, i) => (
        <p key={i} className="friendly-review-warning">
          {warning}
        </p>
      ))}
      {input.moveLine ? <p className="friendly-review-move">{input.moveLine}</p> : null}
      <div className="friendly-review-toolbar">
        {sides.map((side) => (
          <button key={side} onClick={() => setAll(side)}>
            All from {sideLabel(side, serverName)}
          </button>
        ))}
        <label className="friendly-review-showall">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show all
          {hiddenCount > 0 ? ` (${hiddenCount} unchanged)` : ''}
        </label>
      </div>
      <div className="friendly-review-scroll">
        <table className="friendly-review-table">
          <thead>
            <tr>
              <th>Property</th>
              <th>{sideLabel('server', serverName)}</th>
              <th>{sideLabel('local', serverName)}</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>{visible.map(renderRow)}</tbody>
        </table>
      </div>
      {also.length > 0 ? (
        <div className="friendly-review-also">
          <h4>Also changes</h4>
          <ul>
            {also.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {renameTo ? (
        <div className="friendly-review-rename">
          <label>
            <input
              type="checkbox"
              checked={canRename && rename}
              disabled={!canRename}
              onChange={(e) => setRename(e.target.checked)}
            />{' '}
            Rename note to {renameTo.to}
          </label>
          {renameTo.blocked ? <div className="friendly-review-blocked">{renameTo.blocked}</div> : null}
        </div>
      ) : null}
      <div className="friendly-review-buttons">
        <button className="mod-cta" disabled={!ok} onClick={() => onApply(choices, canRename && rename)}>
          Apply
        </button>
        <button onClick={onCancel}>Cancel</button>
        {hint ? <span className="friendly-review-hint">{hint}</span> : null}
      </div>
    </div>
  );
};

export class SyncReviewModal extends Modal {
  private reactRoot: Root | null = null;
  /** How the modal ends: Apply, or an Import that asks for a fresh review; undefined = cancelled. */
  private outcome: 'apply' | 'reopen' | undefined;
  /** Set once closed: an Import finishing after Escape must not reopen anything. */
  private closed = false;

  constructor(
    app: App,
    private input: SyncReviewInput,
    private onApply: (choices: Map<string, Choice>, rename: boolean) => void,
  ) {
    super(app);
  }

  onOpen() {
    this.titleEl.setText(this.input.title);
    this.modalEl.addClass('friendly-review-modal');
    this.reactRoot = createRoot(this.contentEl);
    this.reactRoot.render(
      <SyncReviewContent
        input={this.input}
        linkName={linkDisplayName}
        onApply={(choices, rename) => {
          if (this.closed) return;
          this.outcome = 'apply';
          this.close();
          this.onApply(choices, rename);
        }}
        onCancel={() => this.close()}
        onImported={() => {
          if (this.closed) return;
          this.outcome = 'reopen';
          this.close();
        }}
      />,
    );
  }

  onClose() {
    if (this.closed) return;
    this.closed = true;
    this.reactRoot?.unmount();
    this.reactRoot = null;
    this.contentEl.empty();
    if (this.outcome === 'reopen') this.input.onReopen?.();
    else if (this.outcome === undefined) this.input.onCancel?.();
  }
}
