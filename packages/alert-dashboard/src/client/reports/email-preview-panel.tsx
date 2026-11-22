import { useState } from "react";

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
