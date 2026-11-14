import type { ReactNode } from "react";

/**
 * Placeholders shaped like what is loading. Each uses the real layout's
 * classes, so its rows, cards and headings sit exactly where the data will
 * land and nothing moves when it does. They shimmer only when motion is
 * welcome, and say what is loading to assistive technology without being a
 * live region: toasts are the app's only one.
 */
function Loading({
  what,
  className = "",
  children,
}: {
  what: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`skeleton ${className}`} aria-busy="true">
      <span className="sr-only">{`Loading ${what}…`}</span>
      <div className="skeleton-shape" aria-hidden="true">
        {children}
      </div>
    </div>
  );
}

/** One placeholder bar, as wide as the text it stands for. */
export function Bone({
  width,
  height,
  className = "",
}: {
  width: number | string;
  height?: number;
  className?: string;
}) {
  return (
    <span
      className={`bone ${className}`}
      style={{ width, ...(height === undefined ? {} : { height }) }}
    />
  );
}

// Varied widths read as text rather than as a grid of bars.
const titleWidths = [
  "62%",
  "48%",
  "71%",
  "39%",
  "56%",
  "66%",
  "44%",
  "58%",
  "51%",
  "69%",
];

function RowSkeleton({ index }: { index: number }) {
  return (
    <li className="issue-row">
      <span className="row-check" />
      <Bone width={16} height={16} className="bone-icon" />
      <Bone width={16} height={16} className="bone-icon bone-round" />
      <span className="issue-row-main">
        <span className="identifier">
          <Bone width={38} />
        </span>
        <span className="issue-row-title skeleton-title">
          <Bone width={titleWidths[index % titleWidths.length] ?? "50%"} />
        </span>
      </span>
      <span className="row-date">
        <Bone width={28} />
      </span>
      <Bone width={22} height={22} className="bone-avatar" />
    </li>
  );
}

/** The issue list's first page: a group heading, when grouped, and rows. */
export function ListSkeleton({ grouped }: { grouped: boolean }) {
  return (
    <Loading what="issues" className="issue-list-frame">
      <ul className="issue-list skeleton-list">
        {grouped && (
          <li className="group-row">
            <div className="group-heading">
              <h3>
                <span className="group-toggle">
                  <Bone width={14} height={14} className="bone-icon" />
                  <Bone width={72} />
                </span>
              </h3>
            </div>
          </li>
        )}
        {titleWidths.map((width, index) => (
          <RowSkeleton key={width} index={index} />
        ))}
      </ul>
    </Loading>
  );
}

/** The view toolbar: search, Filter, team and Display, at their heights. */
export function ToolbarSkeleton() {
  return (
    <div className="filters skeleton-toolbar" aria-hidden="true">
      <span className="filter-search">
        <Bone width={90} />
      </span>
      <span className="toolbar-button skeleton-control">
        <Bone width={46} />
      </span>
      <span className="spacer" />
      <span className="picker skeleton-control">
        <Bone width={70} />
      </span>
      <span className="toolbar-button skeleton-control">
        <Bone width={54} />
      </span>
    </div>
  );
}

const cardsPerColumn = [3, 2, 3, 1];

export function BoardSkeleton() {
  return (
    <Loading what="board" className="board">
      {cardsPerColumn.map((cards, column) => (
        <section className="board-column" key={column}>
          <h2>
            <Bone width={14} height={14} className="bone-icon bone-round" />
            <Bone width={64} />
          </h2>
          {Array.from({ length: cards }, (_, card) => (
            <div className="skeleton-card" key={card}>
              <div className="card-top">
                <Bone width={14} height={14} className="bone-icon bone-round" />
                <Bone width={38} />
              </div>
              <span className="card-title">
                <Bone
                  width={
                    titleWidths[(column * 3 + card) % titleWidths.length] ??
                    "60%"
                  }
                />
              </span>
              <div className="card-bottom">
                <Bone width={14} height={14} className="bone-icon" />
                <span className="spacer" />
                <Bone width={20} height={20} className="bone-avatar" />
              </div>
            </div>
          ))}
        </section>
      ))}
    </Loading>
  );
}

/** An issue page or peek: its toolbar, title, description and properties. */
export function DetailSkeleton({
  identifier,
  peek = false,
}: {
  identifier: string;
  peek?: boolean;
}) {
  return (
    <Loading
      what={identifier}
      className={`issue-detail ${peek ? "is-peek" : ""}`}
    >
      <header className="detail-toolbar">
        <Bone width={70} />
        <span className="muted">/</span>
        <span className="identifier">{identifier}</span>
      </header>
      <div className="detail-grid">
        <div className="detail-main">
          <div className="detail-title-heading skeleton-heading">
            <Bone width="58%" height={26} />
          </div>
          <div className="skeleton-paragraph">
            <Bone width="92%" />
            <Bone width="84%" />
            <Bone width="88%" />
            <Bone width="46%" />
          </div>
        </div>
        <aside className="properties">
          <h2>Properties</h2>
          {["Status", "Priority", "Assignee", "Project", "Labels"].map(
            (name) => (
              <div className="property-field" key={name}>
                <span className="property-name">{name}</span>
                <Bone width="100%" height={32} className="bone-field" />
              </div>
            ),
          )}
        </aside>
      </div>
    </Loading>
  );
}

export function ActivitySkeleton() {
  return (
    <Loading what="activity">
      <ol className="activity-list">
        {titleWidths.slice(0, 6).map((width) => (
          <li key={width}>
            <div className="activity-meta">
              <Bone width={22} height={22} className="bone-avatar" />
              <Bone width={80} />
              <Bone width={width} />
            </div>
          </li>
        ))}
      </ol>
    </Loading>
  );
}

export function ActorsSkeleton() {
  return (
    <Loading what="actors" className="actor-grid">
      {titleWidths.slice(0, 6).map((width) => (
        <div className="actor-card" key={width}>
          <Bone width={22} height={22} className="bone-avatar" />
          <Bone width={90} />
          <Bone width={width} />
          <Bone width="70%" />
        </div>
      ))}
    </Loading>
  );
}

export function SettingsSkeleton() {
  return (
    <Loading what="settings" className="settings-page">
      {[0, 1].map((section) => (
        <section key={section}>
          <Bone width={120} height={20} />
          <div className="skeleton-paragraph">
            <Bone width="60%" />
            <Bone width="40%" height={36} />
          </div>
        </section>
      ))}
    </Loading>
  );
}
