import { Temporal } from "@js-temporal/polyfill";
import { useId, type ReactNode } from "react";
import { NavLink } from "react-router";

import { PageHeading } from "#client/ops/ops-ui.tsx";
import { formatInstant } from "#client/time.ts";
import { systemClock } from "#shared/time";

import type { BrimStatus, UsageTotals } from "./schema.ts";
import "./brim.css";

export const cocoaEpochSeconds = 978_307_200;
const currency = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
});
const number = new Intl.NumberFormat();
const statusLabel: Record<BrimStatus, string> = {
  current: "Current",
  sign_in_required: "Sign in on MacBook",
  unavailable: "Provider unavailable",
  disabled: "Disabled",
  not_reporting: "MacBook hasn’t reported",
};

export function dateLabel(value: string | number | null | undefined): string {
  const text =
    typeof value === "number"
      ? Temporal.Instant.fromEpochMilliseconds(
          Math.round((value + cocoaEpochSeconds) * 1000),
        ).toString()
      : (value ?? null);
  return formatInstant(text);
}

export function cocoaNow(): number {
  return systemClock.now().epochMilliseconds / 1000 - cocoaEpochSeconds;
}

export function costLabel(value: UsageTotals): string {
  return `${value.costComplete ? "" : "≥ "}${money(value.costUsd)}`;
}

export function money(value: number): string {
  return currency.format(value);
}

export function quantity(value: number): string {
  return number.format(value);
}

export function ReadingStatus({ status }: { readonly status: BrimStatus }) {
  return (
    <span className="brim-status" data-state={status}>
      {statusLabel[status]}
    </span>
  );
}

export function BrimPage({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <main className="brim-page">
      <title>{`${title} · Hub`}</title>
      <PageHeading title={title} />
      <nav aria-label="Brim views" className="brim-nav">
        <NavLink to="/brim" end>
          Overview
        </NavLink>
        <NavLink to="/brim/usage">Usage</NavLink>
        <NavLink to="/brim/sessions">Sessions</NavLink>
        <NavLink to="/brim/priorities">Herdr priorities</NavLink>
      </nav>
      {children}
    </main>
  );
}

export function BrimSection({
  title,
  aside,
  children,
}: {
  readonly title: string;
  readonly aside?: ReactNode;
  readonly children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="panel brim-panel" aria-labelledby={id}>
      <header className="panel-heading">
        <h2 id={id}>{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

export function BrimTable({
  label,
  columns,
  children,
}: {
  readonly label: string;
  readonly columns: readonly string[];
  readonly children: ReactNode;
}) {
  return (
    <div
      className="brim-table ui-table-scroll"
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      <table className="ui-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function BrimQueryState({
  error,
  label,
}: {
  readonly error: Error | null;
  readonly label: string;
}) {
  return (
    <p className="brim-message" role="status">
      {error === null ? `Loading ${label}…` : error.message}
    </p>
  );
}

export function BrimPager({
  offset,
  step,
  hasMore,
  onPage,
}: {
  readonly offset: number;
  readonly step: number;
  readonly hasMore: boolean;
  readonly onPage: (target: number) => void;
}) {
  if (offset === 0 && !hasMore) return null;
  const previous = Math.max(0, offset - step);
  return (
    <nav aria-label="Page results" className="brim-pager">
      {offset > 0 ? (
        <button
          className="ui-btn"
          type="button"
          onClick={() => {
            onPage(previous);
          }}
        >
          Previous
        </button>
      ) : null}
      {hasMore ? (
        <button
          className="ui-btn"
          type="button"
          onClick={() => {
            onPage(offset + step);
          }}
        >
          Next
        </button>
      ) : null}
    </nav>
  );
}
