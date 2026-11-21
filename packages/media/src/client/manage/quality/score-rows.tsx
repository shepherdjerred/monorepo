import { useId, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { PlusIcon, XIcon } from "lucide-react";
import { Button, IconButton } from "#client/ui/button.tsx";
import { classNames } from "#client/ui/class-names.ts";
import { TextField } from "#client/ui/forms/field.tsx";
import type { ScoreRow } from "./profile-model.ts";
import styles from "./quality.module.css";

const cx = classNames(styles);

function focus(selector: string) {
  document.querySelector<HTMLElement>(selector)?.focus();
}

/**
 * Rows of "this, scored that": a name and the points it adds or takes away.
 * Each input is named `<prefix>.<row id>.key` or `.score`, which is where
 * the surrounding form puts that input's error.
 */
export function ScoreRows({
  legend,
  description,
  prefix,
  rows,
  onChange,
  keyLabel,
  keyPattern,
  keyPatternMessage,
  wholeScores = false,
  scoreRange,
  addLabel,
  empty,
}: {
  legend: string;
  description?: ReactNode;
  prefix: string;
  rows: readonly ScoreRow[];
  onChange: (rows: ScoreRow[]) => void;
  /** What the first column holds: "Trait". */
  keyLabel: string;
  keyPattern?: string;
  keyPatternMessage?: string;
  /** Scores must be whole numbers. */
  wholeScores?: boolean;
  scoreRange?: { min: number; max: number };
  addLabel: string;
  /** Shown while there are no rows. */
  empty: string;
}) {
  const id = useId();
  const descriptionId = description === undefined ? undefined : `${id}-help`;

  function change(rowId: string, patch: Partial<ScoreRow>) {
    onChange(
      rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
    );
  }

  function add() {
    const row = { id: crypto.randomUUID(), key: "", score: "" };
    flushSync(() => {
      onChange([...rows, row]);
    });
    focus(`[name="${CSS.escape(`${prefix}.${row.id}.key`)}"]`);
  }

  function remove(index: number) {
    flushSync(() => {
      onChange(rows.filter((_, position) => position !== index));
    });
    const next = rows[index + 1] ?? rows[index - 1];
    focus(
      next === undefined
        ? `#${CSS.escape(`${id}-add`)}`
        : `[name="${CSS.escape(`${prefix}.${next.id}.key`)}"]`,
    );
  }

  return (
    <fieldset className={cx("scores")} aria-describedby={descriptionId}>
      <legend className={cx("scoresLegend")}>{legend}</legend>
      {description !== undefined && (
        <p className={cx("scoresHelp")} id={descriptionId}>
          {description}
        </p>
      )}
      {rows.length === 0 ? (
        <p className={cx("scoresEmpty")}>{empty}</p>
      ) : (
        <>
          <div className={cx("scoreHead")} aria-hidden="true">
            <span>{keyLabel}</span>
            <span>Score</span>
          </div>
          <ul className={cx("scoreList")}>
            {rows.map((row, index) => {
              const called =
                row.key === "" ? `row ${String(index + 1)}` : row.key;
              return (
                <li className={cx("scoreRow")} key={row.id}>
                  <TextField
                    label={`${keyLabel}, row ${String(index + 1)}`}
                    hideLabel
                    name={`${prefix}.${row.id}.key`}
                    value={row.key}
                    onChange={(event) => {
                      change(row.id, { key: event.target.value });
                    }}
                    required
                    requiredMessage="Name what this score is for."
                    pattern={keyPattern}
                    patternMessage={keyPatternMessage}
                    maxLength={200}
                    autoCapitalize="none"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <TextField
                    label={`Score for ${called}`}
                    hideLabel
                    name={`${prefix}.${row.id}.score`}
                    type="number"
                    step={wholeScores ? "1" : "any"}
                    min={scoreRange?.min}
                    max={scoreRange?.max}
                    value={row.score}
                    onChange={(event) => {
                      change(row.id, { score: event.target.value });
                    }}
                    required
                    requiredMessage="Enter a score."
                    width="full"
                  />
                  <IconButton
                    label={`Remove ${called}`}
                    onClick={() => {
                      remove(index);
                    }}
                  >
                    <XIcon aria-hidden="true" />
                  </IconButton>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <div>
        <Button id={`${id}-add`} onClick={add}>
          <PlusIcon aria-hidden="true" />
          {addLabel}
        </Button>
      </div>
    </fieldset>
  );
}
