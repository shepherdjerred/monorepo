import { createRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { queries } from "#client/queries.ts";
import { PageHeader } from "#client/components/page-header.tsx";
import { Status } from "#client/components/status.tsx";
import { RelativeTime } from "#client/components/time.tsx";
import { DeploymentLink } from "#client/model/selection-facts.tsx";
import { Route as rootRoute } from "./root.tsx";

/** One operator-authorised inspection of a `recovery-required` deployment (4.15). */
function RecoveryIntentPage() {
  const { _splat: intentId = "" } = Route.useParams();
  const { data: intent } = useSuspenseQuery(queries.recoveryIntent(intentId));
  return (
    <>
      <PageHeader
        eyebrow={<DeploymentLink id={intent.deploymentId} />}
        title={`Recovery intent ${String(intent.sequence)}`}
        description={
          <span role="status" className="detail-summary">
            <Status value={intent.outcome} />
            <span>{intent.kind}</span>
            <span>
              requested by {intent.requestedBy}{" "}
              <RelativeTime value={intent.createdAt} />
            </span>
          </span>
        }
      />
      <section className="panel" aria-labelledby="intent-heading">
        <h2 id="intent-heading">Inspection</h2>
        <dl className="facts">
          <div>
            <dt>Deployment</dt>
            <dd>
              <DeploymentLink id={intent.deploymentId} />
            </dd>
          </div>
          <div>
            <dt>Step</dt>
            <dd>{intent.step ?? "Whole deployment"}</dd>
          </div>
          <div>
            <dt>Expected generation</dt>
            <dd>{intent.expectedGeneration}</dd>
          </div>
          <div>
            <dt>Settled</dt>
            <dd>
              {intent.settledAt === null ? (
                "Pending"
              ) : (
                <RelativeTime value={intent.settledAt} />
              )}
            </dd>
          </div>
        </dl>
        <p>{intent.reason}</p>
        <p className="muted">
          Settlement reads the target with a credential the executor does not
          hold, rechecks this fingerprint and generation, and keeps the
          deployment&apos;s result and the accepted selection.
        </p>
        <details>
          <summary>Snapshot fingerprint</summary>
          <p className="mono">{intent.fingerprint}</p>
        </details>
      </section>
      <section className="panel" aria-labelledby="intent-evidence-heading">
        <h2 id="intent-evidence-heading">Inspection evidence</h2>
        {intent.evidence.length === 0 ? (
          <p className="empty">
            The independent reader has recorded nothing yet.
          </p>
        ) : (
          <ul className="evidence">
            {intent.evidence.map((item) => (
              <li key={`${item.kind}:${item.summary}`}>
                <span className="eyebrow">{item.kind}</span>
                <p>{item.summary}</p>
                {item.url !== undefined && (
                  <a href={item.url}>
                    View evidence<span aria-hidden="true"> ↗</span>
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/recovery-intents/$",
  loader: ({ context, params }) =>
    context.queryClient.query({
      ...queries.recoveryIntent(params._splat ?? ""),
      staleTime: "static",
    }),
  component: RecoveryIntentPage,
});
