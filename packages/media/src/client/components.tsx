import { Link } from "react-router";
import type { ReactNode } from "react";

export function PageTitle({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-title">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      {children}
    </header>
  );
}

export function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <div
      className={`notice ${error ? "notice-error" : ""}`}
      role={error ? "alert" : "status"}
    >
      {children}
    </div>
  );
}

export function Loading() {
  return (
    <div className="loading" role="status">
      <span className="loading-dot" />
      Loading your library…
    </div>
  );
}

export function ErrorNotice({ error }: { error: Error }) {
  return <Notice error>{error.message}</Notice>;
}

export function Status({ value }: { value: string }) {
  return <span className={`status status-${value}`}>{humanize(value)}</span>;
}

export function humanize(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

export function dateLabel(value: string | null): string {
  return value === null
    ? "Not scheduled"
    : new Date(value).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-mark" aria-hidden="true">
        ◈
      </span>
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}

export function MediaLink({ id, title }: { id: string; title: string }) {
  return (
    <Link className="media-link" to={`/media/${encodeURIComponent(id)}`}>
      {title}
      <span aria-hidden="true"> ↗</span>
    </Link>
  );
}
