import { createRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { queries } from "#client/queries.ts";
import { PageHeader } from "#client/components/page-header.tsx";
import { Status } from "#client/components/status.tsx";
import { RelativeTime } from "#client/components/time.tsx";
import { DeploymentLink } from "#client/model/selection-facts.tsx";
import { Route as rootRoute } from "./root.tsx";
import { Fact, Facts } from "#client/components/facts.tsx";
import { Disclosure } from "#client/components/disclosure.tsx";
import { RecordedText } from "#client/components/receipt.tsx";

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
        <Facts>
          <Fact label="Deployment">
            <DeploymentLink id={intent.deploymentId} />
          </Fact>
          <Fact label="Step">{intent.step ?? "Whole deployment"}</Fact>
          <Fact label="Expected generation">{intent.expectedGeneration}</Fact>
          <Fact label="Settled">
            {intent.settledAt === null ? (
              "Pending"
            ) : (
              <RelativeTime value={intent.settledAt} />
            )}
          </Fact>
        </Facts>
        <p>{intent.reason}</p>
        <p className="muted">
          Settlement reads the target with a credential the executor does not
          hold, rechecks this fingerprint and generation, and keeps the
          deployment&apos;s result and the accepted selection.
        </p>
        <Disclosure summary="Snapshot fingerprint">
          <p className="mono">{intent.fingerprint}</p>
        </Disclosure>
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
                <RecordedText text={item.summary} />
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
