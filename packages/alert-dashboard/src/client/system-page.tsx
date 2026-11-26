import { Loaded } from "@shepherdjerred/loaded";
import { LoadingBlock } from "@shepherdjerred/loaded/react.tsx";
import { StatusGlyph, type Severity } from "@shepherdjerred/console-ui";
import { useQuery } from "@tanstack/react-query";

import { StaleNotice } from "./stale-notice.tsx";
import { formatInstant } from "./time.ts";
import { useTRPC } from "./trpc.ts";
import { PageHeading } from "#client/ops/ops-ui.tsx";
import type { SystemStatus } from "#shared/schema";

type ComponentState = SystemStatus["mail"] | SystemStatus["alertmanager"];

/** Each component state as a severity glyph and its word. */
const STATE: Readonly<
  Record<ComponentState, { readonly tone: Severity; readonly label: string }>
> = {
  ok: { tone: "ok", label: "OK" },
  error: { tone: "error", label: "Error" },
  stale: { tone: "warning", label: "Stale" },
  pending: { tone: "unknown", label: "Pending" },
  disabled: { tone: "unknown", label: "Disabled" },
};

export function SystemPage(): React.JSX.Element {
  const trpc = useTRPC();
  const status = Loaded.fromQuery(
    useQuery(
      trpc.system.status.queryOptions(undefined, { refetchInterval: 15_000 }),
    ),
  );
  return (
    <LoadingBlock
      values={{ status }}
      fallback={
        <main>
          <div className="loading-state">Loading system health…</div>
        </main>
      }
      renderError={() => (
        <main>
          <div className="error-state">System status is unavailable.</div>
        </main>
      )}
    >
      {({ status: value }, meta) => (
        <main className="ledger">
          <title>System · Hub</title>
          <StaleNotice errors={meta.errors} />
          <PageHeading
            title="System"
            meta="Health of the durable ledger and its external integrations"
          />
          <section
            className="ledger-section"
            aria-labelledby="components-heading"
          >
            <header className="ui-section-head">
              <h2 className="ui-section-title" id="components-heading">
                Components
              </h2>
            </header>
            <div className="ui-table-scroll">
              <table
                className="ui-table system-table"
                aria-labelledby="components-heading"
              >
                <thead>
                  <tr>
                    <th scope="col">Component</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ["Database", value.database],
                      ["Alertmanager", value.alertmanager],
                      ["Grafana", value.grafana],
                      ["Mail", value.mail],
                    ] as const
                  ).map(([name, state]) => (
                    <tr key={name} data-sev={STATE[state].tone}>
                      <th scope="row">{name}</th>
                      <td>
                        <StatusGlyph
                          severity={STATE[state].tone}
                          label={STATE[state].label}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="ledger-section" aria-labelledby="workers-heading">
            <header className="ui-section-head">
              <h2 className="ui-section-title" id="workers-heading">
                Workers
              </h2>
            </header>
            <dl className="def-table">
              <div>
                <dt>Last successful reconciliation</dt>
                <dd className="mono">
                  {formatInstant(value.lastReconciledAt)}
                </dd>
              </div>
              <div>
                <dt>Email delivery</dt>
                <dd>{value.emailEnabled ? "enabled" : "disabled"}</dd>
              </div>
              <div>
                <dt>Pending outbox messages</dt>
                <dd className="mono">{value.pendingEmails}</dd>
              </div>
              <div>
                <dt>Failed outbox messages</dt>
                <dd className="mono">{value.failedEmails}</dd>
              </div>
              <div>
                <dt>Raw webhook retention</dt>
                <dd>90 days</dd>
              </div>
            </dl>
          </section>
        </main>
      )}
    </LoadingBlock>
  );
}
