import type { ReactNode } from "react";
import { Link } from "react-router";
import { ChevronLeftIcon } from "lucide-react";
import { Disclosure, DisclosureList } from "#client/ui/panel.tsx";
import { classNames } from "#client/ui/class-names.ts";
import styles from "./recovery.module.css";

const cx = classNames(styles);

/** A line of prose under a panel's heading or beside its controls. */
export function Plain({ children }: { children: ReactNode }) {
  return <p className={cx("plain")}>{children}</p>;
}

/** What is about to happen, said where the button that does it is. */
export function Before({ children }: { children: ReactNode }) {
  return <p className={cx("before")}>{children}</p>;
}

/** What stands out about the page, above everything else on it. */
export function StatusStack({ children }: { children: ReactNode }) {
  return <div className={cx("standing")}>{children}</div>;
}

/** An in-text link that reads as one. */
export function TextLink({
  to,
  children,
}: {
  to: string;
  children: ReactNode;
}) {
  return (
    <Link className={cx("link")} to={to}>
      {children}
    </Link>
  );
}

/** The way back to the list a page was opened from. */
export function BackLink({
  to,
  children,
}: {
  to: string;
  children: ReactNode;
}) {
  return (
    <Link className={cx("back")} to={to}>
      <ChevronLeftIcon aria-hidden="true" />
      {children}
    </Link>
  );
}

/** Titles, each optionally a link, folded after `limit` so a long list stays short. */
export function TitleList({
  titles,
  limit = 6,
  label,
}: {
  titles: readonly { key: string; title: string; to?: string }[];
  limit?: number;
  /** What the titles are, for the fold: "titles". */
  label: string;
}) {
  const shown = titles.slice(0, limit);
  const rest = titles.slice(limit);
  return (
    <>
      <ul className={cx("titles")}>
        {shown.map((item) => (
          <TitleItem key={item.key} title={item.title} to={item.to} />
        ))}
      </ul>
      {rest.length > 0 && (
        <details className={cx("more")}>
          <summary>
            Show the other {rest.length} {label}
          </summary>
          <ul className={cx("titles")}>
            {rest.map((item) => (
              <TitleItem key={item.key} title={item.title} to={item.to} />
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

/** Titles in a sentence: the first few by name, the rest a click away. */
export function InlineTitles({
  titles,
  limit = 3,
}: {
  titles: readonly string[];
  limit?: number;
}) {
  const rest = titles.slice(limit);
  return (
    <>
      {titles.slice(0, limit).join(", ")}
      {rest.length > 0 && (
        <details className={cx("more")}>
          <summary>
            and {rest.length} more {rest.length === 1 ? "title" : "titles"}
          </summary>
          <p className={cx("restTitles")}>{rest.join(", ")}</p>
        </details>
      )}
    </>
  );
}

function TitleItem({ title, to }: { title: string; to?: string | undefined }) {
  return <li>{to === undefined ? title : <Link to={to}>{title}</Link>}</li>;
}

/** Labelled values, for what the owner may need to copy out of a page. */
export function Facts({
  rows,
  mono = true,
}: {
  rows: readonly (readonly [label: string, value: ReactNode])[];
  /** Values are identifiers and hashes; set them in a fixed-width face. */
  mono?: boolean;
}) {
  return (
    <dl className={mono ? cx("facts") : `${cx("facts")} ${cx("plainFacts")}`}>
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The raw identifiers and hashes of a thing, closed until asked for. */
export function TechnicalDetails({
  rows,
}: {
  rows: readonly (readonly [label: string, value: ReactNode])[];
}) {
  return (
    <DisclosureList>
      <Disclosure title="Technical details">
        <Facts rows={rows} />
      </Disclosure>
    </DisclosureList>
  );
}
