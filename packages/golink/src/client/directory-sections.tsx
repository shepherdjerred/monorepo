import type { RefObject } from "react";
import type {
  DynamicLinkKind,
  LinkKind,
  ShortcutSpec,
  Viewer,
} from "#shared/contract.ts";

export type KindFilter = "all" | "manual" | "ingress" | "site" | "alias";

export type KindCounts = {
  all: number;
  manual: number;
  ingress: number;
  site: number;
  alias: number;
};

const KIND_FILTER_OPTIONS: readonly {
  value: KindFilter;
  label: string;
}[] = [
  { value: "all", label: "All" },
  { value: "manual", label: "Manual" },
  { value: "ingress", label: "Tailnet" },
  { value: "site", label: "Public Sites" },
  { value: "alias", label: "Auto-Aliases" },
];

export function describeDynamicKind(kind: DynamicLinkKind): string {
  switch (kind) {
    case "ingress": {
      return "Tailnet Ingress";
    }
    case "site": {
      return "Platform Site";
    }
    case "alias": {
      return "Auto-Alias";
    }
    case "shortcut": {
      return "Shortcut";
    }
  }
}

export function describeLinkKind(kind: LinkKind): string {
  return kind === "manual" ? "Manual" : describeDynamicKind(kind);
}

function formatViewerTitle(
  viewerLogin: string,
  viewerDisplay: string | null,
): string {
  return viewerDisplay === null || viewerDisplay.length === 0
    ? viewerLogin
    : `${viewerDisplay} (${viewerLogin})`;
}

export function DirectoryHeader({
  manualCount,
  dynamicCount,
  shortcutCount,
  viewer,
  writesEnabled,
}: {
  manualCount: number;
  dynamicCount: number;
  shortcutCount: number;
  viewer: Viewer | null;
  writesEnabled: boolean;
}) {
  const viewerLogin = viewer?.login ?? null;
  const viewerDisplay = viewer?.displayName ?? null;

  return (
    <header className="site-header">
      <div className="brand-cluster">
        <a href="/" className="brand-badge" aria-label="go/ home">
          go/
        </a>
        <div className="brand-title-block">
          <h1 className="site-title">Shortlink Directory</h1>
          <p className="live-counts">
            <span>{String(manualCount)} manual</span>
            <span aria-hidden="true">·</span>
            <span>{String(dynamicCount)} dynamic</span>
            <span aria-hidden="true">·</span>
            <span>{String(shortcutCount)} shortcuts</span>
          </p>
        </div>
      </div>

      <div className="header-pills">
        {!writesEnabled && (
          <span className="viewer-pill viewer-pill-muted">Read-only mode</span>
        )}
        {viewerLogin === null || viewerLogin.length === 0 ? (
          <span className="viewer-pill viewer-pill-muted">Tailnet viewer</span>
        ) : (
          <span
            className="viewer-pill"
            title={formatViewerTitle(viewerLogin, viewerDisplay)}
          >
            <span className="viewer-dot" aria-hidden="true" />
            <span>{viewerLogin}</span>
          </span>
        )}
      </div>
    </header>
  );
}

export function SearchFilterBar({
  query,
  kindFilter,
  counts,
  searchInputRef,
  onQueryChange,
  onKindFilterChange,
}: {
  query: string;
  kindFilter: KindFilter;
  counts: KindCounts;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onQueryChange: (next: string) => void;
  onKindFilterChange: (next: KindFilter) => void;
}) {
  return (
    <search aria-label="Filter shortlinks" className="directory-search">
      <form
        action="/"
        method="get"
        className="search-controls"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <div className="field search-field">
          <div className="search-label-row">
            <label htmlFor="directory-filter-input">Filter directory</label>
            <kbd className="shortcut-kbd" aria-hidden="true">
              /
            </kbd>
          </div>
          <span id="search-hint" className="hint">
            Match shortlink name, destination URL, or source detail.
          </span>
          <div className="search-input-row">
            <input
              ref={searchInputRef}
              id="directory-filter-input"
              name="q"
              type="search"
              value={query}
              placeholder="Filter go/ links, hosts, or services…"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="search"
              aria-describedby="search-hint"
              onChange={(event) => {
                onQueryChange(event.target.value);
              }}
            />
            {query.length > 0 && (
              <button
                type="button"
                className="btn btn-secondary search-clear-btn"
                onClick={() => {
                  onQueryChange("");
                  searchInputRef.current?.focus();
                }}
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <fieldset className="kind-fieldset">
          <legend className="kind-legend">Filter by source</legend>
          <div className="radio-pill-group">
            {KIND_FILTER_OPTIONS.map((option) => {
              const radioId = `kind-filter-${option.value}`;
              const optionCount = counts[option.value];
              return (
                <div key={option.value} className="radio-pill">
                  <input
                    type="radio"
                    id={radioId}
                    name="kind"
                    value={option.value}
                    checked={kindFilter === option.value}
                    onChange={() => {
                      onKindFilterChange(option.value);
                    }}
                  />
                  <label htmlFor={radioId}>
                    <span>{option.label}</span>
                    <span className="pill-count">{String(optionCount)}</span>
                  </label>
                </div>
              );
            })}
          </div>
        </fieldset>
      </form>
    </search>
  );
}

export function ShortcutsSection({
  shortcuts,
}: {
  shortcuts: readonly ShortcutSpec[];
}) {
  if (shortcuts.length === 0) {
    return null;
  }

  return (
    <section
      className="shortcuts-section"
      aria-labelledby="shortcuts-section-heading"
    >
      <div className="section-heading-row">
        <h2 id="shortcuts-section-heading">Parameterized Shortcuts</h2>
        <span className="section-subtitle">
          Dynamic path templates resolved on the fly
        </span>
      </div>
      <div className="shortcuts-grid">
        {shortcuts.map((spec) => (
          <article key={spec.pattern} className="shortcut-card">
            <div className="shortcut-pattern">
              <span className="shortlink-prefix">go/</span>
              <code>{spec.pattern}</code>
            </div>
            <p className="shortcut-description">{spec.description}</p>
            <div className="shortcut-example">
              <span className="shortcut-example-label">Example:</span>
              <a
                href={`/${spec.exampleShort}`}
                className="shortcut-example-link"
              >
                go/{spec.exampleShort}
              </a>
              <span className="shortcut-arrow" aria-hidden="true">
                →
              </span>
              <span className="shortcut-target">{spec.exampleTargetUrl}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
