import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { DeploymentDetail as Detail } from "#shared/contract.ts";
import { Disclosure } from "#client/components/disclosure.tsx";
import { Identifier } from "#client/components/identifier.tsx";
import { Receipt } from "#client/components/receipt.tsx";
import { Status } from "#client/components/status.tsx";
import { Duration, RelativeTime } from "#client/components/time.tsx";
import {
  deploymentEvidenceCount,
  groupEvidence,
  parseEvidenceSummary,
  type EvidenceGroups,
  type EvidenceItem,
} from "./evidence.ts";

/** A group lists this many pieces of evidence before folding the rest away. */
const VISIBLE_EVIDENCE = 5;

const RECOVERY_LABELS = {
  argo: "Lock recovery",
  worker: "Worker recovery",
  content: "Content recovery",
} as const;

function EvidenceEntry({
  item,
  origin,
}: {
  item: EvidenceItem;
  /** What recorded it, when the group does not already say. */
  origin?: ReactNode;
}) {
  const parsed = parseEvidenceSummary(item.summary);
  return (
    <li>
      <div className="evidence-head">
        <span className="eyebrow">{item.kind}</span>
        {parsed.kind === "record" && parsed.adapter !== null && (
          <strong className="evidence-adapter">{parsed.adapter}</strong>
        )}
        <span className="evidence-meta">
          <RelativeTime value={item.createdAt} />
          {item.operationId !== undefined && (
            <span>
              operation <Identifier value={item.operationId} />
            </span>
          )}
          {origin !== undefined && <span>{origin}</span>}
        </span>
        {item.url !== undefined && (
          <a href={item.url}>
            View evidence<span aria-hidden="true"> ↗</span>
          </a>
        )}
      </div>
      <Receipt parsed={parsed} />
    </li>
  );
}

function EvidenceList({
  items,
  origin,
  limit,
}: {
  items: EvidenceItem[];
  origin?: (item: EvidenceItem) => ReactNode;
  /** Fold everything past this many items into a disclosure. */
  limit?: number;
}) {
  const visible = limit === undefined ? items : items.slice(0, limit);
  const rest = limit === undefined ? [] : items.slice(limit);
  const entry = (item: EvidenceItem) => (
    <EvidenceEntry key={item.id} item={item} origin={origin?.(item)} />
  );
  return (
    <>
      <ul className="evidence">{visible.map((item) => entry(item))}</ul>
      {rest.length > 0 && (
        <Disclosure summary="More" count={rest.length}>
          <ul className="evidence">{rest.map((item) => entry(item))}</ul>
        </Disclosure>
      )}
    </>
  );
}

function grouped(detail: Detail) {
  return groupEvidence(
    detail.deployment.id,
    detail.stages.map((stage) => stage.key),
    detail.evidence,
  );
}

type Stage = Detail["stages"][number];
type DeploymentState = Pick<Detail["deployment"], "status">;

/** The deployment states nothing runs in any more. */
const ENDED: ReadonlySet<string> = new Set(["succeeded", "failed", "canceled"]);

/**
 * Whether a step is interrupted: still recorded as running after its
 * deployment ended. Nothing reported how it ended, so its outcome is unknown.
 */
export function interrupted(
  stage: Pick<Stage, "status">,
  deployment: DeploymentState,
) {
  return stage.status === "running" && ENDED.has(deployment.status);
}

/**
 * When a step's clock stops: when it last reported, or, for an interrupted
 * step, when its deployment ended. A running step's clock keeps going.
 */
export function stepEnd(
  stage: Pick<Stage, "status" | "updatedAt">,
  deployment: Pick<Detail["deployment"], "status" | "finishedAt">,
) {
  if (interrupted(stage, deployment))
    return deployment.finishedAt ?? stage.updatedAt;
  return stage.status === "running" ? null : stage.updatedAt;
}

/** What an empty step list means for a deployment in this state. */
export function noStepsMessage(deployment: DeploymentState) {
  switch (deployment.status) {
    case "succeeded": {
      return "No step history was recorded for this deployment.";
    }
    case "failed":
    case "canceled": {
      return "The deployment ended before any step started.";
    }
    case "queued":
    case "awaiting_approval":
    case "running": {
      return "No stages have started.";
    }
  }
}

/** A step's state: an interrupted one reads as such, not as running. */
export function StepStatus({
  stage,
  deployment,
}: {
  stage: Pick<Stage, "status">;
  deployment: DeploymentState;
}) {
  return interrupted(stage, deployment) ? (
    <Status value="unknown" label="interrupted · outcome unknown" />
  ) : (
    <Status value={stage.status} />
  );
}

/**
 * Each step in the order it started, with what it recorded beneath it. A
 * settled step folds its evidence away; a failed, running or interrupted one
 * shows it.
 */
export function StepTimeline({ detail }: { detail: Detail }) {
  const { deployment } = detail;
  if (detail.stages.length === 0)
    return <p className="empty">{noStepsMessage(deployment)}</p>;
  const groups = grouped(detail);
  const stages = detail.stages.toSorted((left, right) =>
    (left.startedAt ?? left.updatedAt).localeCompare(
      right.startedAt ?? right.updatedAt,
    ),
  );
  return (
    <ol className="step-timeline">
      {stages.map((stage) => {
        const items = groups.steps.get(stage.key) ?? [];
        const message =
          stage.message === "" ? null : parseEvidenceSummary(stage.message);
        const record = message?.kind === "record" ? message : null;
        return (
          <li
            key={stage.id}
            className={`step step-${interrupted(stage, deployment) ? "interrupted" : stage.status}`}
          >
            <div className="step-head">
              <strong className="step-key">{stage.key}</strong>
              <StepStatus stage={stage} deployment={deployment} />
              {stage.startedAt !== null && (
                <Duration
                  start={stage.startedAt}
                  end={stepEnd(stage, deployment)}
                />
              )}
              <span className="step-meta">
                operation <Identifier value={stage.operationId} />
              </span>
              {items.length === 0 && (
                <span className="step-meta">no evidence</span>
              )}
            </div>
            {message?.kind === "text" && (
              <p className="step-message">{message.text}</p>
            )}
            {(items.length > 0 || record !== null) && (
              <Disclosure
                summary={items.length > 0 ? "Evidence" : "Step message"}
                {...(items.length > 0 ? { count: items.length } : {})}
                open={stage.status !== "succeeded"}
              >
                {record !== null && (
                  <div className="step-record">
                    {items.length > 0 && (
                      <span className="eyebrow">Step message </span>
                    )}
                    {record.adapter !== null && (
                      <strong className="evidence-adapter">
                        {record.adapter}
                      </strong>
                    )}
                    <Receipt parsed={record} />
                  </div>
                )}
                {items.length > 0 && <EvidenceList items={items} />}
              </Disclosure>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <h3>{title}</h3>
      {children}
    </>
  );
}

function OutsideSteps({ groups }: { groups: EvidenceGroups }) {
  return (
    <>
      {groups.finish.length > 0 && (
        <Group title="Reported with the result">
          <EvidenceList items={groups.finish} limit={VISIBLE_EVIDENCE} />
        </Group>
      )}
      {groups.monitor.length > 0 && (
        <Group title="Monitor">
          <EvidenceList items={groups.monitor} limit={VISIBLE_EVIDENCE} />
        </Group>
      )}
      {groups.drift.length > 0 && (
        <Group title="Drift">
          <EvidenceList items={groups.drift} limit={VISIBLE_EVIDENCE} />
        </Group>
      )}
      {groups.recovery.length > 0 && (
        <Group title="Recovery">
          {groups.recovery.map((settled) => (
            <EvidenceList
              key={`${settled.recovery}/${settled.intentId}`}
              items={settled.items}
              limit={VISIBLE_EVIDENCE}
              origin={() => (
                <>
                  {RECOVERY_LABELS[settled.recovery]} intent{" "}
                  <Link
                    to="/recovery-intents/$"
                    params={{ _splat: settled.intentId }}
                  >
                    <Identifier value={settled.intentId} />
                  </Link>
                </>
              )}
            />
          ))}
        </Group>
      )}
      {groups.unlistedSteps.length > 0 && (
        <Group title="Steps not listed">
          {groups.unlistedSteps.map((step) => (
            <EvidenceList
              key={step.key}
              items={step.items}
              limit={VISIBLE_EVIDENCE}
              origin={() => <>step {step.key}</>}
            />
          ))}
        </Group>
      )}
      {groups.other.length > 0 && (
        <Group title="Other evidence">
          <EvidenceList
            items={groups.other}
            limit={VISIBLE_EVIDENCE}
            origin={(item) => (
              <>
                id <Identifier value={item.id} />
              </>
            )}
          />
        </Group>
      )}
    </>
  );
}

/** Where the evidence that is not listed here went: under the steps. */
function underStepsNote(underSteps: number, outside: number) {
  const where =
    underSteps === 1
      ? "is shown under the step that recorded it"
      : "are shown under the steps that recorded them";
  if (outside > 0) return `${String(underSteps)} more ${where}.`;
  return underSteps === 1
    ? `The only piece of evidence ${where}.`
    : `All ${String(underSteps)} pieces of evidence ${where}.`;
}

/**
 * The evidence no listed step recorded: what the executor reported with the
 * result, what the monitor and recovery wrote, and ids of any other shape.
 */
export function DeploymentEvidence({ detail }: { detail: Detail }) {
  if (detail.evidence.length === 0)
    return <p className="empty">No verification evidence recorded.</p>;
  const groups = grouped(detail);
  const outside = deploymentEvidenceCount(groups);
  const underSteps = detail.evidence.length - outside;
  return (
    <>
      {underSteps > 0 && (
        <p className="muted">{underStepsNote(underSteps, outside)}</p>
      )}
      <OutsideSteps groups={groups} />
    </>
  );
}
