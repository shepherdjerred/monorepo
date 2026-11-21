import * as Sentry from "@sentry/react";
import type { ReactNode } from "react";
import { lastApiReference } from "@shepherdjerred/streambot/web/client/api.ts";
import "@shepherdjerred/streambot/web/client/styles/shell.css";
import "@shepherdjerred/streambot/web/client/styles/status.css";

function CrashNotice() {
  const reference = lastApiReference();
  return (
    <main className="welcome">
      <h1 className="page-heading">Something went wrong</h1>
      <p className="status">
        <span className="status-error">
          <span>Streambot hit an error it could not recover from.</span>
          {reference !== null && (
            <span className="status-reference">
              Reference <code>{reference}</code>
            </span>
          )}
        </span>
      </p>
      <button
        type="button"
        className="btn"
        onClick={() => {
          location.reload();
        }}
      >
        Reload the page
      </button>
    </main>
  );
}

// The HOC form rather than <Sentry.ErrorBoundary>: the class component's types do not satisfy
// React 19's JSX element checks. It renders the fallback whether or not Sentry was initialised.
const Guarded = Sentry.withErrorBoundary(
  (props: { children: ReactNode }) => props.children,
  { fallback: <CrashNotice /> },
);

/** Catches a render crash anywhere below it, reports it to Bugsink and offers a reload. */
export function ErrorBoundary(props: { children: ReactNode }) {
  return <Guarded>{props.children}</Guarded>;
}
