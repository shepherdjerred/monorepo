import { useRef, useState } from "react";
import { useSearchParams } from "react-router";

import {
  nextRovingTabIndex,
  parseDetailViewMode,
  type DetailViewMode,
} from "./reports-format.ts";

const DETAIL_VIEW_TABS: readonly {
  readonly id: DetailViewMode;
  readonly label: string;
}[] = [
  { id: "inspector", label: "Inspector" },
  { id: "email", label: "Rendered Email" },
];

export function useDetailViewMode(): {
  readonly viewMode: DetailViewMode;
  readonly setView: (next: DetailViewMode) => void;
} {
  const [params, setParams] = useSearchParams();
  const viewMode = parseDetailViewMode(params.get("view"));
  const setView = (next: DetailViewMode) => {
    const updated = new URLSearchParams(params);
    if (next === "inspector") {
      updated.delete("view");
    } else {
      updated.set("view", next);
    }
    setParams(updated, { replace: true });
  };
  return { viewMode, setView };
}

export function DetailViewTabs(p: {
  readonly ariaLabel: string;
  readonly idPrefix: string;
  readonly viewMode: DetailViewMode;
  readonly onSelect: (next: DetailViewMode) => void;
}): React.JSX.Element {
  const { ariaLabel, idPrefix, viewMode, onSelect } = p;
  const tabRefs = useRef(new Map<DetailViewMode, HTMLButtonElement>());
  return (
    <div role="tablist" aria-label={ariaLabel} className="eng-tablist">
      {DETAIL_VIEW_TABS.map((tab, index) => (
        <button
          key={tab.id}
          id={`${idPrefix}-tab-${tab.id}`}
          ref={(node) => {
            if (node === null) {
              tabRefs.current.delete(tab.id);
            } else {
              tabRefs.current.set(tab.id, node);
            }
          }}
          role="tab"
          type="button"
          className="eng-tab"
          aria-selected={viewMode === tab.id}
          tabIndex={viewMode === tab.id ? 0 : -1}
          onClick={() => {
            onSelect(tab.id);
          }}
          onKeyDown={(event) => {
            const nextIdx = nextRovingTabIndex(
              event.key,
              index,
              DETAIL_VIEW_TABS.length,
            );
            const nextTab =
              nextIdx === null ? undefined : DETAIL_VIEW_TABS[nextIdx];
            if (nextTab !== undefined) {
              event.preventDefault();
              onSelect(nextTab.id);
              tabRefs.current.get(nextTab.id)?.focus();
            }
          }}
        >
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}

export type EmailReceiptRow = {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
};

export function EmailPreviewPanel(p: {
  readonly htmlBody: string;
  readonly plainBody: string | null;
  readonly metadata?: readonly EmailReceiptRow[];
}): React.JSX.Element {
  const { htmlBody, plainBody, metadata } = p;
  const [format, setFormat] = useState<"html" | "text">("html");
  const hasPlain = plainBody !== null && plainBody.length > 0;
  const activeFormat = format === "text" && !hasPlain ? "html" : format;

  return (
    <section className="panel rep-email-panel" aria-label="Rendered email">
      <header className="rep-email-header">
        <div>
          <h2 className="rep-panel-title">Rendered email payload</h2>
          <p className="rep-panel-sub">
            Sandboxed HTML and plain-text projections stored with the run
          </p>
        </div>
        <div
          className="segmented"
          role="radiogroup"
          aria-label="Email body format"
        >
          <button
            type="button"
            role="radio"
            aria-checked={activeFormat === "html"}
            onClick={() => {
              setFormat("html");
            }}
          >
            HTML preview
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={activeFormat === "text"}
            disabled={!hasPlain}
            onClick={() => {
              setFormat("text");
            }}
          >
            Plain text
          </button>
        </div>
      </header>

      {metadata === undefined || metadata.length === 0 ? null : (
        <dl className="rep-meta-grid rep-email-meta">
          {metadata.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd className={row.mono === false ? undefined : "mono"}>
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {activeFormat === "html" ? (
        <div className="rep-email-frame-wrap">
          <iframe
            sandbox=""
            title="Rendered email preview"
            srcDoc={htmlBody}
            className="rep-email-iframe"
          />
        </div>
      ) : (
        <pre className="rep-code-block rep-plain-email">{plainBody}</pre>
      )}
    </section>
  );
}
