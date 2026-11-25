import { Chip } from "@shepherdjerred/console-ui";
import type {
  BreadcrumbView,
  EventDetail,
  ExceptionView,
  StackFrameView,
} from "#shared/contract.ts";
import { formatTimestamp, groupStackFrames } from "./format.ts";

function formatFrameLocation(frame: StackFrameView): string {
  const base = frame.filename ?? frame.module ?? "<anonymous>";
  if (frame.lineno === null) {
    return base;
  }
  return frame.colno === null
    ? `${base}:${String(frame.lineno)}`
    : `${base}:${String(frame.lineno)}:${String(frame.colno)}`;
}

function FrameSourceContext({
  frame,
}: {
  readonly frame: StackFrameView;
}): React.JSX.Element | null {
  const hasContext =
    frame.contextLine !== null ||
    frame.preContext.length > 0 ||
    frame.postContext.length > 0;
  if (!hasContext) {
    return null;
  }
  const activeLine = frame.lineno ?? frame.preContext.length + 1;
  const startLine = activeLine - frame.preContext.length;

  return (
    <div className="er-code-context">
      {frame.preContext.map((line, offset) => {
        const lineNumber = startLine + offset;
        return (
          <div key={`pre-${String(lineNumber)}`} className="er-code-line">
            <span className="er-code-lineno">{lineNumber}</span>
            <span>{line}</span>
          </div>
        );
      })}
      {frame.contextLine === null ? null : (
        <div className="er-code-line er-code-line-active">
          <span className="er-code-lineno">{activeLine}</span>
          <span>{frame.contextLine}</span>
        </div>
      )}
      {frame.postContext.map((line, offset) => {
        const lineNumber = activeLine + offset + 1;
        return (
          <div key={`post-${String(lineNumber)}`} className="er-code-line">
            <span className="er-code-lineno">{lineNumber}</span>
            <span>{line}</span>
          </div>
        );
      })}
    </div>
  );
}

function StackFrameRow({
  frame,
  showContext,
}: {
  readonly frame: StackFrameView;
  readonly showContext: boolean;
}): React.JSX.Element {
  const varEntries = frame.vars === null ? [] : Object.entries(frame.vars);
  return (
    <div className="er-frame">
      <div className="er-frame-head">
        <span className="er-frame-loc ui-mono">
          {formatFrameLocation(frame)}
        </span>
        <span className="er-frame-fn">
          in <code>{frame.function ?? "<anonymous>"}</code>
        </span>
        {frame.inApp ? (
          <Chip label="Scope" value="in-app" severity="info" />
        ) : null}
      </div>
      {showContext ? <FrameSourceContext frame={frame} /> : null}
      {varEntries.length > 0 ? (
        <details className="er-frame-vars">
          <summary>{`Local variables (${String(varEntries.length)})`}</summary>
          <pre className="er-vars-pre ui-mono">
            {JSON.stringify(frame.vars, null, 2)}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

function ExceptionCard({
  exception,
}: {
  readonly exception: ExceptionView;
}): React.JSX.Element {
  const groups = groupStackFrames(exception.frames);
  return (
    <article className="er-exception-card">
      <div className="er-exception-head">
        <span className="er-exception-title">
          <strong>{exception.type}</strong>
          {exception.value.length > 0 ? `: ${exception.value}` : ""}
        </span>
        {exception.mechanismType === null ? null : (
          <Chip label="Mechanism" value={exception.mechanismType} />
        )}
        {exception.handled === null ? null : (
          <Chip
            label="Handled"
            value={exception.handled ? "yes" : "no"}
            severity={exception.handled ? "warning" : "error"}
          />
        )}
      </div>
      {groups.length === 0 ? (
        <div className="er-frame ui-muted">No stack frames captured.</div>
      ) : (
        <div className="er-frames">
          {groups.map((group) => {
            if (group.kind === "app") {
              return (
                <StackFrameRow
                  key={`app-${String(group.index)}`}
                  frame={group.frame}
                  showContext
                />
              );
            }
            const count = group.frames.length;
            const label =
              count === 1 ? "1 vendor frame" : `${String(count)} vendor frames`;
            return (
              <details
                key={`vendor-${String(group.startIndex)}`}
                className="er-vendor-frames"
              >
                <summary className="er-vendor-summary">{label}</summary>
                <div className="er-vendor-list">
                  {group.frames.map((vendorFrame, offset) => (
                    <StackFrameRow
                      key={`vendor-${String(group.startIndex + offset)}`}
                      frame={vendorFrame}
                      showContext={false}
                    />
                  ))}
                </div>
              </details>
            );
          })}
        </div>
      )}
    </article>
  );
}

function BreadcrumbsSection({
  breadcrumbs,
}: {
  readonly breadcrumbs: readonly BreadcrumbView[];
}): React.JSX.Element | null {
  if (breadcrumbs.length === 0) {
    return null;
  }
  return (
    <section className="er-section" aria-labelledby="er-breadcrumbs-heading">
      <div className="ui-section-head">
        <h2 className="ui-section-title" id="er-breadcrumbs-heading">
          Breadcrumbs
        </h2>
        <span className="ui-count">{breadcrumbs.length}</span>
      </div>
      <div
        className="ui-table-scroll"
        tabIndex={0}
        role="region"
        aria-labelledby="er-breadcrumbs-heading"
      >
        <table className="ui-table er-table">
          <thead>
            <tr>
              <th scope="col">Timestamp</th>
              <th scope="col">Category</th>
              <th scope="col">Level</th>
              <th scope="col">Message</th>
            </tr>
          </thead>
          <tbody>
            {breadcrumbs.map((crumb, index) => (
              <tr key={`crumb-${String(index)}`}>
                <td className="ui-mono ui-muted">
                  {formatTimestamp(crumb.timestamp)}
                </td>
                <td className="ui-mono">
                  {crumb.category ?? crumb.type ?? "default"}
                </td>
                <td className="ui-mono ui-muted">{crumb.level ?? "info"}</td>
                <td>
                  {crumb.message ??
                    (crumb.data === null ? "—" : JSON.stringify(crumb.data))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TagsAndContextSection({
  event,
}: {
  readonly event: EventDetail;
}): React.JSX.Element | null {
  const tagEntries = Object.entries(event.tags);
  const contextEntries = Object.entries(event.contexts);
  const sdkLabel =
    event.sdk?.name === null || event.sdk?.name === undefined
      ? null
      : `${event.sdk.name}${event.sdk.version === null ? "" : `@${event.sdk.version}`}`;
  const hasTags = sdkLabel !== null || tagEntries.length > 0;
  const hasContext = event.request !== null || contextEntries.length > 0;
  if (!hasTags && !hasContext) {
    return null;
  }

  return (
    <section className="er-section" aria-labelledby="er-tags-heading">
      <div className="ui-section-head">
        <h2 className="ui-section-title" id="er-tags-heading">
          Tags &amp; Context
        </h2>
      </div>
      <div className="er-section-body">
        {hasTags ? (
          <div className="er-chip-wrap">
            {sdkLabel === null ? null : <Chip label="sdk" value={sdkLabel} />}
            {tagEntries.map(([key, value]) => (
              <Chip key={key} label={key} value={value} />
            ))}
          </div>
        ) : null}

        {hasContext ? (
          <div className="er-context-grid">
            {event.request === null ? null : (
              <div className="er-context-card">
                <h3 className="er-context-title">Request</h3>
                <pre className="er-context-pre ui-mono">
                  {JSON.stringify(event.request, null, 2)}
                </pre>
              </div>
            )}
            {contextEntries.map(([name, ctxValue]) => (
              <div key={name} className="er-context-card">
                <h3 className="er-context-title">{name}</h3>
                <pre className="er-context-pre ui-mono">
                  {JSON.stringify(ctxValue, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function EventInspectorPanels({
  event,
}: {
  readonly event: EventDetail | null;
}): React.JSX.Element {
  if (event === null) {
    return (
      <p className="er-state">
        No stored event occurrences remain for this issue.
      </p>
    );
  }

  return (
    <>
      <section className="er-section" aria-labelledby="er-stacktrace-heading">
        <div className="ui-section-head">
          <h2 className="ui-section-title" id="er-stacktrace-heading">
            Stacktrace
          </h2>
          {event.exceptions.length > 0 ? (
            <span className="ui-count">
              {event.exceptions.length}{" "}
              {event.exceptions.length === 1 ? "exception" : "exceptions"}
            </span>
          ) : null}
        </div>
        <div className="er-section-body">
          {event.exceptions.length > 0 ? (
            <div className="er-exception-list">
              {event.exceptions.map((exception, index) => (
                <ExceptionCard
                  key={`exc-${String(index)}`}
                  exception={exception}
                />
              ))}
            </div>
          ) : (
            <pre
              className="er-stacktrace-md ui-mono"
              tabIndex={0}
              role="region"
              aria-label="Formatted event summary"
            >
              {event.stacktraceMd.length > 0
                ? event.stacktraceMd
                : "No exception stacktrace recorded on this event."}
            </pre>
          )}
        </div>
      </section>

      <TagsAndContextSection event={event} />
      <BreadcrumbsSection breadcrumbs={event.breadcrumbs} />

      <section className="er-section">
        <details className="er-raw-json">
          <summary className="er-raw-summary">Raw Event JSON</summary>
          <pre
            className="er-raw-pre ui-mono"
            tabIndex={0}
            role="region"
            aria-label="Raw event JSON"
          >
            {JSON.stringify(event.rawData, null, 2)}
          </pre>
        </details>
      </section>
    </>
  );
}
