import { useQuery } from "@tanstack/react-query";
import type { Link as ToolLink } from "@shepherdjerred/ops-model/snapshot.ts";
import type {
  CiRun,
  CiStage,
  CiWorkflow,
  UnavailableReason,
} from "#shared/hub/integration-contract.ts";
import { queries } from "#client/queries.ts";
import { Status } from "./status.tsx";
import { Duration, RelativeTime } from "./time.tsx";
import { ShortSha, ToolLinks } from "./links.tsx";
import { ErrorNotice } from "./notices.tsx";

const REASONS: Record<UnavailableReason, string> = {
  "not-configured": "Not configured",
  disabled: "Turned off",
  "not-applicable": "Not applicable",
  "upstream-error": "Upstream error",
  timeout: "Timed out",
};

function Unavailable({
  reason,
  detail,
  links,
}: {
  reason: UnavailableReason;
  detail: string;
  links: ToolLink[];
}) {
  return (
    <div className="integration-unavailable">
      <p>
        <strong>{REASONS[reason]}.</strong> {detail}
      </p>
      <ToolLinks links={links} />
    </div>
  );
}

const STAGE_TITLES: Record<CiStage, string> = {
  test: "Tests",
  build: "Build",
  publish: "Publish",
  other: "Other checks",
};

function Workflow({ workflow }: { workflow: CiWorkflow }) {
  return (
    <li>
      <details open={workflow.status === "failed"}>
        <summary>
          <Status value={workflow.status} />
          <strong>{workflow.name}</strong>
          {workflow.startedAt !== null && (
            <Duration start={workflow.startedAt} end={workflow.finishedAt} />
          )}
        </summary>
        <ol className="steps">
          {workflow.steps.map((step) => (
            <li key={step.pid}>
              <Status value={step.status} />
              <a href={step.url}>{step.name}</a>
              {step.status === "failed" && (
                <span className="muted"> exit {step.exitCode}</span>
              )}
            </li>
          ))}
        </ol>
      </details>
    </li>
  );
}

function CiRunBody({ run }: { run: CiRun }) {
  return (
    <>
      <p className="detail-summary">
        <Status value={run.status} />
        <a href={run.url}>
          Woodpecker #{run.number}
          <span aria-hidden="true"> ↗</span>
        </a>
        <span>
          {run.event} on {run.branch}
        </span>
        {run.startedAt !== null && (
          <Duration start={run.startedAt} end={run.finishedAt} />
        )}
      </p>
      {(["test", "build", "publish", "other"] as const).map((stage) => {
        const workflows = run.workflows.filter(
          (workflow) => workflow.stage === stage,
        );
        return workflows.length === 0 ? null : (
          <div key={stage} className="ci-group">
            <h3>{STAGE_TITLES[stage]}</h3>
            <ul className="workflows">
              {workflows.map((workflow) => (
                <Workflow key={workflow.pid} workflow={workflow} />
              ))}
            </ul>
          </div>
        );
      })}
    </>
  );
}

export function CiRunPanel({ buildId }: { buildId: string }) {
  const ci = useQuery(queries.ci(buildId));
  return (
    <section className="panel" aria-labelledby="ci-heading">
      <h2 id="ci-heading">Build and tests</h2>
      {ci.isPending && <p role="status">Loading CI run…</p>}
      {ci.error !== null && <ErrorNotice error={ci.error} />}
      {ci.data?.state === "unavailable" && <Unavailable {...ci.data} />}
      {ci.data?.state === "available" && <CiRunBody run={ci.data.data} />}
    </section>
  );
}

export function SourcePanel({
  buildId,
  sha,
}: {
  buildId: string;
  sha: string;
}) {
  const source = useQuery(queries.source(buildId));
  return (
    <section className="panel" aria-labelledby="source-heading">
      <h2 id="source-heading">Source</h2>
      {source.isPending && <p role="status">Loading commit…</p>}
      {source.error !== null && <ErrorNotice error={source.error} />}
      {source.data?.state === "unavailable" && (
        <>
          <p className="mono">{sha}</p>
          <Unavailable {...source.data} />
        </>
      )}
      {source.data?.state === "available" && (
        <>
          <p className="source-headline">
            <strong>{source.data.data.headline}</strong>
          </p>
          <p className="muted">
            <ShortSha sha={source.data.data.sha} /> by{" "}
            {source.data.data.authorLogin ??
              source.data.data.authorName ??
              "unknown author"}{" "}
            · <RelativeTime value={source.data.data.committedAt} />
          </p>
          {source.data.data.pullRequest !== null && (
            <p>
              <a href={source.data.data.pullRequest.url}>
                #{source.data.data.pullRequest.number}{" "}
                {source.data.data.pullRequest.title}
                <span aria-hidden="true"> ↗</span>
              </a>
            </p>
          )}
          {source.data.data.body !== "" && (
            <details>
              <summary>Commit message</summary>
              <pre className="commit-body">{source.data.data.body}</pre>
            </details>
          )}
          <ToolLinks links={source.data.links} />
        </>
      )}
    </section>
  );
}

export function RuntimePanel({ environmentId }: { environmentId: string }) {
  const runtime = useQuery(queries.runtime(environmentId));
  return (
    <section className="panel" aria-labelledby="runtime-heading">
      <h2 id="runtime-heading">Live runtime</h2>
      {runtime.isPending && <p role="status">Reading ArgoCD…</p>}
      {runtime.error !== null && <ErrorNotice error={runtime.error} />}
      {runtime.data?.state === "unavailable" && (
        <Unavailable {...runtime.data} />
      )}
      {runtime.data?.state === "available" && (
        <>
          <dl className="facts">
            <div>
              <dt>Sync</dt>
              <dd>{runtime.data.data.syncStatus}</dd>
            </div>
            <div>
              <dt>Health</dt>
              <dd>{runtime.data.data.healthStatus}</dd>
            </div>
            <div>
              <dt>Revision</dt>
              <dd className="mono">{runtime.data.data.syncRevision ?? "—"}</dd>
            </div>
            <div>
              <dt>Last operation</dt>
              <dd>
                {runtime.data.data.operationPhase ?? "None"}
                {runtime.data.data.operationFinishedAt !== null && (
                  <>
                    {" · "}
                    <RelativeTime
                      value={runtime.data.data.operationFinishedAt}
                    />
                  </>
                )}
              </dd>
            </div>
          </dl>
          {runtime.data.data.imageChecks.length > 0 && (
            <ul className="image-checks">
              {runtime.data.data.imageChecks.map((check) => (
                <li key={check.component}>
                  <Status value={check.matches ? "succeeded" : "failed"} />
                  {check.component}{" "}
                  {check.matches
                    ? "runs the accepted digest"
                    : "differs from the accepted digest"}
                </li>
              ))}
            </ul>
          )}
          <ToolLinks links={runtime.data.links} />
        </>
      )}
    </section>
  );
}
