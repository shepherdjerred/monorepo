import { StatusGlyph } from "@shepherdjerred/console-ui";
import type {
  ArchiveEnvelopeRefView,
  WaterfallSpan,
} from "@shepherdjerred/ops-model/llm-traces.ts";
import { useId, useState } from "react";

import { statusPill } from "#client/ops/pages/cluster-page.tsx";
import { formatValue } from "#shared/ops-format";

function formatAttrValue(value: unknown): string {
  if (typeof value === "string") return value;
  return typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : JSON.stringify(value);
}

function AttributeList({
  record,
}: {
  readonly record: Readonly<Record<string, unknown>>;
}): React.JSX.Element {
  const entries = Object.entries(record);
  if (entries.length === 0) {
    return <p className="rep-panel-sub">No attributes recorded.</p>;
  }
  return (
    <dl className="traces-attr-list">
      {entries.map(([key, val]) => (
        <div key={key} className="traces-attr-row">
          <dt>{key}</dt>
          <dd>{formatAttrValue(val)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function WaterfallInspector({
  spans,
  totalDurationMs,
}: {
  readonly spans: readonly WaterfallSpan[];
  readonly totalDurationMs: number | null;
}): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(
    spans[0]?.spanId ?? null,
  );
  const selected =
    spans.find((span) => span.spanId === selectedId) ?? spans[0] ?? null;

  const maxEnd = Math.max(
    1,
    totalDurationMs ?? 0,
    ...spans.map((span) => span.offsetMs + span.durationMs),
  );

  if (spans.length === 0) {
    return (
      <div className="panel empty-state">
        No waterfall spans available for this trace.
      </div>
    );
  }

  return (
    <div className="traces-waterfall-grid">
      <section className="panel" aria-label="Span waterfall">
        <div className="traces-panel-head">
          <h3 className="rep-panel-title">
            {`Span timeline (${String(spans.length)})`}
          </h3>
          <span className="mono traces-short-id">
            {formatValue(totalDurationMs, "ms")}
          </span>
        </div>
        <ul className="traces-waterfall-list">
          {spans.map((span) => {
            const leftPct = Math.min(98, (span.offsetMs / maxEnd) * 100);
            const widthPct = Math.min(
              100 - leftPct,
              Math.max(0.5, (span.durationMs / maxEnd) * 100),
            );
            const isSelected = selected?.spanId === span.spanId;
            return (
              <li key={span.spanId}>
                <button
                  type="button"
                  className="traces-wf-row"
                  aria-pressed={isSelected}
                  onClick={() => {
                    setSelectedId(span.spanId);
                  }}
                >
                  <span
                    className="traces-wf-name"
                    style={{
                      paddingInlineStart: `${String(Math.min(span.depth, 6) * 14)}px`,
                    }}
                  >
                    <span>{span.name}</span>
                    {span.isLlmSpan ? (
                      <span className="visual-pill" data-sev="info">
                        LLM
                      </span>
                    ) : null}
                    {span.status === "error" ? (
                      <span className="visual-pill" data-sev="error">
                        ERR
                      </span>
                    ) : null}
                  </span>
                  <span className="traces-wf-track" aria-hidden="true">
                    <span
                      className={`traces-wf-bar${span.status === "error" ? " traces-wf-bar-error" : ""}`}
                      style={{
                        left: `${String(leftPct)}%`,
                        width: `${String(widthPct)}%`,
                      }}
                    />
                  </span>
                  <span className="traces-wf-dur">
                    {formatValue(span.durationMs, "ms")}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {selected === null ? null : (
        <section
          className="panel metadata"
          aria-label="Selected span inspector"
        >
          <h2>{selected.name}</h2>
          <dl>
            <div>
              <dt>Span ID</dt>
              <dd className="mono">{selected.spanId}</dd>
            </div>
            <div>
              <dt>Parent span ID</dt>
              <dd className="mono">{selected.parentSpanId ?? "root"}</dd>
            </div>
            <div>
              <dt>Service &amp; scope</dt>
              <dd className="mono">
                {selected.scopeName === null
                  ? selected.service
                  : `${selected.service} (${selected.scopeName})`}
              </dd>
            </div>
            <div>
              <dt>Offset / duration</dt>
              <dd className="mono">
                {`+${formatValue(selected.offsetMs, "ms")} · ${formatValue(selected.durationMs, "ms")}`}
              </dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <StatusGlyph
                  severity={selected.status === "error" ? "error" : "ok"}
                />
              </dd>
            </div>
          </dl>

          {selected.statusMessage === null ? null : (
            <p className="inline-error">{selected.statusMessage}</p>
          )}

          <h3>Resource attributes</h3>
          <AttributeList record={selected.resourceAttributes} />

          <h3>Span attributes</h3>
          <AttributeList record={selected.attributes} />

          {selected.events.length === 0 ? null : (
            <>
              <h3>{`Span events (${String(selected.events.length)})`}</h3>
              {selected.events.map((ev, idx) => (
                <div key={idx} className="traces-msg">
                  <div className="traces-msg-role">
                    <span>{ev.name}</span>
                  </div>
                  <AttributeList record={ev.attributes} />
                </div>
              ))}
            </>
          )}
        </section>
      )}
    </div>
  );
}

export function ArchiveAttributesPanel({
  archiveRefs,
  rootSpan,
}: {
  readonly archiveRefs: readonly ArchiveEnvelopeRefView[];
  readonly rootSpan: WaterfallSpan | undefined;
}): React.JSX.Element {
  const headingId = useId();

  return (
    <div className="traces-tabpanel">
      <section className="panel" aria-labelledby={headingId}>
        <div className="traces-panel-head">
          <div>
            <h3 className="rep-panel-title" id={headingId}>
              {`SeaweedFS archive envelopes (${String(archiveRefs.length)})`}
            </h3>
            <p className="rep-panel-sub">
              Gzipped prompt/response S3 objects retained for 365 days in
              SeaweedFS.
            </p>
          </div>
        </div>

        {archiveRefs.length === 0 ? (
          <div className="empty-state">
            No SeaweedFS archive references were recorded on this trace&apos;s
            spans.
          </div>
        ) : (
          <div
            tabIndex={0}
            role="region"
            aria-labelledby={headingId}
            className="ui-table-scroll traces-table-wrap"
          >
            <table
              className="ui-table traces-table"
              aria-labelledby={headingId}
            >
              <thead>
                <tr>
                  <th scope="col">Span</th>
                  <th scope="col">Service &amp; provider</th>
                  <th scope="col">S3 key</th>
                  <th scope="col">SHA-256</th>
                  <th scope="col">Compressed / raw</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {archiveRefs.map((ref) => (
                  <tr key={`${ref.spanId}:${ref.s3Key}`}>
                    <td data-label="Span">
                      <div className="traces-cell-stack">
                        <span className="mono">{ref.spanName}</span>
                        <span className="traces-short-id mono">
                          {ref.spanId}
                        </span>
                      </div>
                    </td>
                    <td data-label="Service">
                      <div className="traces-pill-wrap">
                        <span className="mono">{ref.service}</span>
                        <span className="visual-pill">{ref.provider}</span>
                      </div>
                    </td>
                    <td data-label="S3 key">
                      <code className="rep-mailbox-chip">
                        {ref.s3Bucket === null
                          ? ref.s3Key
                          : `s3://${ref.s3Bucket}/${ref.s3Key}`}
                      </code>
                    </td>
                    <td data-label="SHA-256" className="mono">
                      {ref.sha256 === null
                        ? "—"
                        : `${ref.sha256.slice(0, 16)}…`}
                    </td>
                    <td data-label="Size" className="mono">
                      {`${formatValue(ref.bytesCompressed, "bytes")} / ${formatValue(ref.bytesUncompressed, "bytes")}`}
                    </td>
                    <td data-label="Status">
                      {ref.status === "ok"
                        ? statusPill("ok", "✓", ref.status)
                        : statusPill("warning", "!", ref.status)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {rootSpan === undefined ? null : (
        <section
          className="panel metadata"
          aria-label="Root resource attributes"
        >
          <h2>Root resource attributes</h2>
          <AttributeList record={rootSpan.resourceAttributes} />
        </section>
      )}
    </div>
  );
}
