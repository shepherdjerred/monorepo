import type { ReactNode } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "./button.tsx";
import { classNames } from "./class-names.ts";
import { Badge, Callout } from "./feedback.tsx";
import { Disclosure, DisclosureList } from "./panel.tsx";
import styles from "./workflow.module.css";

const cx = classNames(styles);

export type Step = {
  /** The section of the page this step is, as an in-page address. */
  to: string;
  title: string;
  /** Where the owner stands in this step, in a few words. */
  state: string;
  /** `ok` for a step that is done, `warn` for one that waits on the owner. */
  tone: "neutral" | "ok" | "warn";
};

/**
 * The steps of a process in order, each with where it stands. It answers
 * "where am I" at the top of a page that is several sections long, and each
 * step is a link to its section.
 */
export function StepList({
  label,
  steps,
}: {
  label: string;
  steps: readonly Step[];
}) {
  return (
    <nav aria-label={label}>
      <ol className={cx("steps")}>
        {steps.map((step) => (
          <li className={cx("step")} key={step.to}>
            <a className={cx("stepLink")} href={step.to}>
              {step.title}
            </a>
            <Badge tone={step.tone}>{step.state}</Badge>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * Long proofs, hashes, and identifiers: always on the page and found by
 * in-page search, folded away until the owner wants them.
 */
export function TechnicalDetails({ children }: { children: ReactNode }) {
  return (
    <DisclosureList>
      <Disclosure title="Technical details">
        <div className={cx("technical")}>{children}</div>
      </Disclosure>
    </DisclosureList>
  );
}

/** Names and values, side by side when there is room. */
export function Facts({
  items,
}: {
  items: readonly { name: string; value: ReactNode }[];
}) {
  return (
    <dl className={cx("facts")}>
      {items.map((item) => (
        <div className={cx("fact")} key={item.name}>
          <dt>{item.name}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A long hash or path, set so it wraps instead of widening the page. */
export function Code({ children }: { children: ReactNode }) {
  return <code className={cx("code")}>{children}</code>;
}

/**
 * The part of a panel where the owner decides: what the decision does, the
 * acknowledgement and the button that records it. It is set apart by a rule so
 * it is never mistaken for more evidence.
 */
export function Decision({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className={cx("decision")}>
      <h3 className={cx("decisionTitle")}>{title}</h3>
      {children}
    </section>
  );
}

/**
 * An action that was refused or failed: what the action was, why, and what
 * state things are in now. A change that did not happen says so in `state`;
 * `action` is the control that moves on, such as reloading the current
 * version.
 */
export function ActionFailure({
  title,
  error,
  state,
  action,
}: {
  title: string;
  error: Error;
  state: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Callout tone="danger" title={title} action={action}>
      <p className={cx("failure")}>{error.message}</p>
      <p className={cx("failure")}>{state}</p>
    </Callout>
  );
}

/**
 * A checkbox that is the whole of a row's name: the label around it is the
 * target, so it is as large as the text beside it.
 */
export function PickBox({
  checked,
  disabled = false,
  onChange,
  children,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className={cx("pick")} data-disabled={disabled || undefined}>
      <input
        className={cx("pickBox")}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
      <span>{children}</span>
    </label>
  );
}

/** Rows of checkboxes, set apart so each reads as its own choice. */
export function PickList({
  children,
  ...field
}: {
  children: ReactNode;
  "data-field": string;
  "data-field-label": string;
  tabIndex: -1;
}) {
  return (
    <div className={cx("pickList")} {...field}>
      {children}
    </div>
  );
}

/** Previous and next for a list read a page at a time. */
export function Pager({
  what,
  from,
  to,
  total,
  onPrevious,
  onNext,
}: {
  /** What the list holds, plural: "records". */
  what: string;
  /** 1-based position of the first and last row shown. */
  from: number;
  to: number;
  total: number;
  onPrevious: (() => void) | null;
  onNext: (() => void) | null;
}) {
  return (
    <div className={cx("pager")}>
      <p className={cx("pagerCount")}>
        {from}–{to} of {total} {what}
      </p>
      <div className={cx("pagerButtons")}>
        <Button
          disabled={onPrevious === null}
          onClick={() => {
            onPrevious?.();
          }}
        >
          <ChevronLeftIcon aria-hidden="true" />
          Previous {what}
        </Button>
        <Button
          disabled={onNext === null}
          onClick={() => {
            onNext?.();
          }}
        >
          Next {what}
          <ChevronRightIcon aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
