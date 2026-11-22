import { useId, type ReactNode } from "react";
import { classNames } from "#client/ui/class-names.ts";
import {
  COMMON_LANGUAGES,
  MORE_LANGUAGES,
  type LanguageOption,
} from "./languages.ts";
import { LANGUAGE_LIMIT } from "./form.ts";
import styles from "./controls.module.css";

const cx = classNames(styles);

/** A question of the sheet with one or more controls answering it. */
export function Question({
  legend,
  hint,
  children,
}: {
  legend: string;
  hint?: string;
  children: ReactNode;
}) {
  const hintId = useId();
  return (
    <fieldset
      className={cx("question")}
      aria-describedby={hint === undefined ? undefined : hintId}
    >
      <legend className={cx("legend")}>{legend}</legend>
      {hint !== undefined && (
        <p className={cx("hint")} id={hintId}>
          {hint}
        </p>
      )}
      {children}
    </fieldset>
  );
}

/** A labelled native `<select>`, for a choice among more than a few. */
export function Choice({
  label,
  hint,
  value,
  disabled,
  autoFocus = false,
  onChange,
  children,
}: {
  label: string;
  hint?: string;
  value: string;
  disabled: boolean;
  /** The sheet's first control takes focus when the sheet opens. */
  autoFocus?: boolean;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className={cx("choice")}>
      <label className={cx("legend")} htmlFor={id}>
        {label}
      </label>
      <select
        className={cx("select")}
        id={id}
        value={value}
        disabled={disabled}
        aria-describedby={hint === undefined ? undefined : `${id}-hint`}
        data-autofocus={autoFocus ? "" : undefined}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        {children}
      </select>
      {hint !== undefined && (
        <p className={cx("hint")} id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}

/** One of a few mutually exclusive answers, each with a line saying what it means. */
export function Options<Value extends string>({
  legend,
  name,
  value,
  disabled,
  autoFocus = false,
  options,
  onChange,
}: {
  legend: string;
  name: string;
  value: Value | "";
  disabled: boolean;
  autoFocus?: boolean;
  options: readonly { value: Value; label: string; detail: string }[];
  onChange: (value: Value) => void;
}) {
  return (
    <Question legend={legend}>
      <div className={cx("options")}>
        {options.map((option, index) => (
          <label className={cx("option")} key={option.value}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              disabled={disabled}
              data-autofocus={autoFocus && index === 0 ? "" : undefined}
              onChange={() => {
                onChange(option.value);
              }}
            />
            <span>
              <span className={cx("optionLabel")}>{option.label}</span>
              <span className={cx("optionDetail")}>{option.detail}</span>
            </span>
          </label>
        ))}
      </div>
    </Question>
  );
}

/** A checkbox and its label on one row that is a comfortable touch target. */
export function Tick({
  label,
  checked,
  disabled,
  autoFocus = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  autoFocus?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={cx("tick")}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        data-autofocus={autoFocus ? "" : undefined}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
      <span>{label}</span>
    </label>
  );
}

function LanguageTicks({
  languages,
  chosen,
  disabled,
  autoFocus = false,
  onToggle,
}: {
  languages: readonly LanguageOption[];
  chosen: readonly string[];
  disabled: boolean;
  autoFocus?: boolean;
  onToggle: (code: string, checked: boolean) => void;
}) {
  const full = chosen.length >= LANGUAGE_LIMIT;
  return (
    <div className={cx("ticks")}>
      {languages.map((language, index) => {
        const checked = chosen.includes(language.code);
        return (
          <Tick
            key={language.code}
            label={language.label}
            checked={checked}
            // A language already chosen can always be given up.
            disabled={disabled || (full && !checked)}
            autoFocus={autoFocus && index === 0}
            onChange={(next) => {
              onToggle(language.code, next);
            }}
          />
        );
      })}
    </div>
  );
}

/**
 * The subtitle languages a request asks for: the household's two up front,
 * the rest one disclosure away. Choosing none asks for no subtitles.
 */
export function LanguagePicker({
  value,
  disabled,
  autoFocus = false,
  onChange,
}: {
  value: readonly string[];
  disabled: boolean;
  autoFocus?: boolean;
  onChange: (languages: string[]) => void;
}) {
  const toggle = (code: string, checked: boolean) => {
    onChange(
      checked
        ? [...value.filter((chosen) => chosen !== code), code]
        : value.filter((chosen) => chosen !== code),
    );
  };
  const more = MORE_LANGUAGES.filter((language) =>
    value.includes(language.code),
  ).length;
  return (
    <Question
      legend="Subtitles"
      hint="Media looks for subtitles in each language you choose."
    >
      <LanguageTicks
        languages={COMMON_LANGUAGES}
        chosen={value}
        disabled={disabled}
        autoFocus={autoFocus}
        onToggle={toggle}
      />
      <details className={cx("more")}>
        <summary>
          {more === 0
            ? "More languages"
            : `More languages, ${String(more)} chosen`}
        </summary>
        <LanguageTicks
          languages={MORE_LANGUAGES}
          chosen={value}
          disabled={disabled}
          onToggle={toggle}
        />
      </details>
    </Question>
  );
}

/** A sentence about the request that asks nothing of the reader. */
export function Note({ children }: { children: ReactNode }) {
  return <p className={cx("note")}>{children}</p>;
}

/** What the request has done so far, announced when it appears. */
export function Report({ children }: { children: ReactNode }) {
  return (
    <p className={cx("note")} role="status">
      {children}
    </p>
  );
}

/** What stops the sheet from being sent, announced when it appears. */
export function Problem({ children }: { children: ReactNode }) {
  return (
    <p className={cx("problem")} role="alert">
      {children}
    </p>
  );
}
