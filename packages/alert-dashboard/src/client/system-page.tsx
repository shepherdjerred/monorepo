import { Loaded } from "@shepherdjerred/loaded";
import { LoadingBlock } from "@shepherdjerred/loaded/react.tsx";
import { useQuery } from "@tanstack/react-query";

import { StaleNotice } from "./stale-notice.tsx";
import { formatInstant } from "./time.ts";
import { useTRPC } from "./trpc.ts";

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
        <main>
          <title>System · Alerts</title>
          <StaleNotice errors={meta.errors} />
          <div className="page-heading">
            <div>
              <p className="eyebrow">Operational status</p>
              <h1>System</h1>
              <p>Health of the durable ledger and its external integrations.</p>
            </div>
          </div>
          <section className="health-grid">
            {[
              { name: "Database", state: value.database },
              { name: "Alertmanager", state: value.alertmanager },
              { name: "Grafana", state: value.grafana },
              { name: "Postal", state: value.postal },
            ].map(({ name, state }) => (
              <article className="health-card" key={name}>
                <span className={`health-dot ${state}`} />
                <div>
                  <h2>{name}</h2>
                  <strong>{state}</strong>
                </div>
              </article>
            ))}
          </section>
          <section className="panel metadata">
            <h2>Workers</h2>
            <dl>
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
