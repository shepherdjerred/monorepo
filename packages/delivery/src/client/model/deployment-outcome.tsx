import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { DeploymentDetailV2 } from "#shared/model/contract.ts";
import { groupEvidence } from "#client/evidence.ts";
import {
  readbackOutcome,
  recoveryReading,
  settledWords,
  stepMessage,
  NO_CAUSE as NO_CAUSE_RECORDED,
  type RecoveryReading,
} from "#shared/evidence/recovery-reading.ts";
import { interrupted } from "#client/deployment-steps.tsx";
import { CopyableIdentifier } from "#client/components/copyable.tsx";
import { revisionLabel } from "#client/components/identifier.tsx";
import { sayOnce, spoken } from "./failure-words.ts";
import { retryable } from "./view.ts";

type Detail = Pick<
  DeploymentDetailV2,
  "deployment" | "stages" | "evidence" | "recoveryIntents" | "environment"
> &
  Partial<
    Pick<DeploymentDetailV2, "acceptedRelease" | "newerRequest" | "versionSet">
  >;

/**
 * What is true of an ended deployment beyond the status its executor left,
 * from the record around it:
 *
 * - `superseded`: the environment has since accepted a release requested
 *   after this one, so retrying this one would move it backwards.
 * - `queued`: a request made after this one has not finished, so the
 *   environment refuses a retry until it settles.
 * - `recovered`: recovery read every external operation back as Succeeded,
 *   and the environment accepts or was observed running this release.
 * - `applied`: recovery read every operation back as Succeeded, but
 *   Delivery never accepted the release and has not observed it running.
 *
 * Null when the status says it all.
 */
export type Verdict =
  | { kind: "superseded"; deploymentId: string; revision: number }
  | {
      kind: "queued";
      deploymentId: string;
      revision: number;
      status: "queued" | "running" | "awaiting_approval";
    }
  | { kind: "recovered" }
  | { kind: "applied"; acceptedRevision: number | null };

export function deploymentVerdict(detail: Detail): Verdict | null {
  const { deployment } = detail;
  const ended =
    deployment.status === "failed" || deployment.status === "canceled";
  if (!ended || deployment.recoveryRequired) return null;
  const accepted = detail.acceptedRelease ?? null;
  if (
    accepted !== null &&
    accepted.deploymentId !== deployment.id &&
    Date.parse(accepted.requestedAt) > Date.parse(deployment.createdAt)
  )
    return {
      kind: "superseded",
      deploymentId: accepted.deploymentId,
      revision: accepted.revision,
    };
  const recovery = recoveryVerdict(detail);
  if (recovery?.kind === "recovered") return recovery;
  // Nothing newer was accepted, but a newer request that has not finished
  // makes the environment refuse a retry until it settles.
  const newer = detail.newerRequest ?? null;
  return newer === null ? recovery : { kind: "queued", ...newer };
}

/** What recovery's readback says of an ended deployment: recovered, applied, or nothing. */
function recoveryVerdict(detail: Detail): Verdict | null {
  const { deployment, environment } = detail;
  const accepted = detail.acceptedRelease ?? null;
  const reading = recoveryReading(detail.recoveryIntents);
  if (
    reading === null ||
    deployment.status !== "failed" ||
    readbackOutcome(reading) !== "succeeded"
  )
    return null;
  const set = deployment.versionSetRevisionId;
  // A matching set revision proves this release runs only when the
  // deployment moved the set; a rebind keeps the accepted set and changes
  // the recipe or configuration, which only its own acceptance shows.
  const movedSet = deployment.previousAcceptedVersionSetRevisionId !== set;
  return environment.acceptedDeploymentId === deployment.id ||
    (movedSet &&
      (environment.acceptedVersionSetRevisionId === set ||
        environment.observedVersionSetRevisionId === set))
    ? { kind: "recovered" }
    : { kind: "applied", acceptedRevision: accepted?.revision ?? null };
}

/**
 * Whether the page offers a retry: a retryable deployment nothing has
 * superseded or recovered, and no newer request is waiting to settle.
 */
export function offersRetry(detail: Detail) {
  const verdict = deploymentVerdict(detail);
  return (
    retryable(detail.deployment) &&
    verdict?.kind !== "superseded" &&
    verdict?.kind !== "queued" &&
    verdict?.kind !== "recovered"
  );
}

/** The status the page header shows: the record's, and what is true beyond it. */
export function headerStatus(detail: Detail): {
  value: string;
  label: string | null;
} {
  const verdict = deploymentVerdict(detail);
  const { status } = detail.deployment;
  switch (verdict?.kind) {
    case "superseded": {
      return {
        value: status,
        label: `${status} · superseded by ${revisionLabel(verdict.revision)}`,
      };
    }
    case "queued": {
      return { value: status, label: null };
    }
    case "recovered": {
      return { value: "succeeded", label: "failed, then recovered" };
    }
    case "applied": {
      return { value: "unknown", label: "failed · applied, not accepted" };
    }
    case undefined: {
      return { value: status, label: null };
    }
  }
}

/** Whether the page says why this deployment failed or why it holds its lock. */
export function explainsFailure(deployment: {
  status: string;
  recoveryRequired: boolean;
}) {
  return deployment.status === "failed" || deployment.recoveryRequired;
}

const JOB = /\bJob (?<job>[a-z0-9][\w.-]*\/[a-z0-9][\w.-]*)/u;
const UID =
  /\bUID (?<uid>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/iu;

/**
 * The Kubernetes Job and UID a failure's records name, so "inspect its
 * recorded UID" points at one. Newest evidence first; each value once.
 */
export function failurePointers(detail: Pick<Detail, "evidence" | "stages">) {
  const texts = [
    ...detail.evidence.toReversed().map((item) => item.summary),
    ...detail.stages.map((stage) => stage.message),
  ];
  const pointers: { label: "Job" | "UID"; value: string }[] = [];
  for (const [label, pattern, group] of [
    ["Job", JOB, "job"],
    ["UID", UID, "uid"],
  ] as const) {
    const value = texts
      .map((text) => pattern.exec(text)?.groups?.[group])
      .find((found) => found !== undefined);
    if (value !== undefined) pointers.push({ label, value });
  }
  return pointers;
}

/**
 * The step that failed, or else the one the deployment outlived, and the
 * last evidence it recorded: or what the executor reported with the result.
 */
function failingStep(detail: Detail) {
  const { deployment } = detail;
  const failed = detail.stages.find((entry) => entry.status === "failed");
  const stage =
    failed ?? detail.stages.find((entry) => interrupted(entry, deployment));
  const groups = groupEvidence(
    deployment.id,
    detail.stages.map((entry) => entry.key),
    detail.evidence,
  );
  const fromStep =
    stage === undefined ? undefined : groups.steps.get(stage.key)?.at(-1);
  return {
    stage,
    outcome:
      failed === undefined ? ("interrupted" as const) : ("failed" as const),
    item: fromStep ?? groups.finish[0],
    from: fromStep === undefined ? null : (stage?.key ?? null),
  };
}

/** What the operator does next: recover the lock, retry, or request another release. */
function nextStep(detail: Detail) {
  if (detail.deployment.recoveryRequired) return "recover" as const;
  return offersRetry(detail) ? ("retry" as const) : ("request" as const);
}

/**
 * Why a deployment failed, from what it recorded: its message, the step that
 * failed or was interrupted, the last evidence that step (or the result)
 * recorded, and what the operator can do next. Each clause is said once, and
 * the instructions the records carry are gathered under what to do.
 *
 * Once a recovery intent has settled and released the lock, what the
 * executor said while the outcome was unknown ("External operation may
 * still be active") is stale: the story reports what recovery read back
 * instead. Null for a deployment that neither failed nor holds a recovery
 * lock.
 */
export function failureStory(detail: Detail) {
  const { deployment } = detail;
  if (!explainsFailure(deployment)) return null;
  const { stage, outcome, item, from } = failingStep(detail);
  const intent = detail.recoveryIntents.toSorted(
    (left, right) => right.sequence - left.sequence,
  )[0];
  const settled = deployment.recoveryRequired
    ? null
    : recoveryReading(detail.recoveryIntents);
  const once = sayOnce();
  const message = settled === null ? once.say(deployment.message) : null;
  const raw = stage === undefined ? null : stepMessage(stage);
  const stepText = once.say(raw === null ? null : spoken(raw));
  const evidenceText = once.say(
    item === undefined ? null : spoken(item.summary, item.kind),
  );
  const verdict = deploymentVerdict(detail);
  return {
    heading: storyHeading(deployment, verdict),
    verdict,
    message,
    settled,
    step:
      stage === undefined
        ? null
        : { key: stage.key, outcome, message: stepText },
    evidence: evidenceText === null ? null : { from, text: evidenceText },
    remedies: once.remedies,
    pointers: failurePointers(detail),
    locked: deployment.recoveryRequired,
    intent:
      intent === undefined
        ? null
        : { id: intent.id, sequence: intent.sequence, outcome: intent.outcome },
    next: nextStep(detail),
    /**
     * Whether any record says why: a message, a step's words, evidence or a
     * readback of a failed phase. A readback of Succeeded says the work
     * finished, which is no cause.
     */
    caused:
      message !== null ||
      stepText !== null ||
      evidenceText !== null ||
      (settled !== null && readbackOutcome(settled) !== "succeeded"),
    /** Whether recovery read the external work back as finished, which explains no failure. */
    readbackFinished:
      settled !== null && readbackOutcome(settled) === "succeeded",
  };
}

function storyHeading(
  deployment: Detail["deployment"],
  verdict: Verdict | null,
) {
  if (verdict?.kind === "recovered") return "How it recovered";
  return deployment.status === "failed" ? "Why it failed" : "Why it is locked";
}

type Story = NonNullable<ReturnType<typeof failureStory>>;

/** What a settled recovery read back, in place of the executor's stale headline. */
function SettledHeadline({ settled }: { settled: RecoveryReading }) {
  return (
    <p className="failure-message">
      <Link to="/recovery-intents/$" params={{ _splat: settled.id }}>
        Recovery intent {settled.sequence}
      </Link>
      {settledWords(settled)}
    </p>
  );
}

function StepSentence({
  step,
  settled,
}: {
  step: NonNullable<Story["step"]>;
  settled: boolean;
}) {
  const ending =
    step.outcome === "failed"
      ? "failed"
      : settled
        ? "was still running when the deployment ended; recovery has since read its outcome back"
        : "was still running when the deployment ended, so its outcome is unknown";
  return (
    <p>
      Step <strong className="mono">{step.key}</strong> {ending}
      {step.message === null ? "." : `: ${step.message}`}
    </p>
  );
}

/** Where to read a failure no record explains. */
const NO_CAUSE =
  "No cause was recorded. Read the steps and evidence below and the Temporal workflow linked above to find it,";

/** What is true of the release beyond the failure, and what that leaves to do. */
function VerdictStep({
  verdict,
  environment,
  revision,
}: {
  verdict: Verdict;
  environment: ReactNode;
  revision: string;
}) {
  switch (verdict.kind) {
    case "superseded": {
      return (
        <p>
          Superseded by{" "}
          <Link
            to="/deployments/$deploymentId"
            params={{ deploymentId: verdict.deploymentId }}
          >
            {revisionLabel(verdict.revision)}
          </Link>
          : {environment} has since accepted a newer request, so nothing is left
          to fix here. Retry is off, because retrying {revision} would replace{" "}
          {revisionLabel(verdict.revision)} with this older request.
        </p>
      );
    }
    case "queued": {
      return (
        <p>
          A newer request,{" "}
          <Link
            to="/deployments/$deploymentId"
            params={{ deploymentId: verdict.deploymentId }}
          >
            {revisionLabel(verdict.revision)}
          </Link>
          , is {verdict.status.replaceAll("_", " ")}; Retry is off until it
          settles, because {environment} refuses another request while one is
          unfinished. Once it settles, request another release from{" "}
          {environment} if {revision} is still needed.
        </p>
      );
    }
    case "recovered": {
      return (
        <p>
          Nothing: {environment} runs {revision}. The executor lost track of its
          external work, and recovery read that work back as finished.
        </p>
      );
    }
    case "applied": {
      return (
        <p>
          The external work finished, so {revision}&apos;s change was applied,
          but Delivery never accepted {revision}:{" "}
          {verdict.acceptedRevision === null
            ? "nothing is accepted in "
            : `${revisionLabel(verdict.acceptedRevision)} is still accepted in `}
          {environment}. Check its live runtime to see what runs, then retry
          this deployment so Delivery accepts {revision}, or request another
          release.
        </p>
      );
    }
  }
}

function NextStep({
  story,
  environmentId,
  revision,
}: {
  story: Story;
  environmentId: string;
  revision: string;
}) {
  const environment = (
    <Link to="/environments/$" params={{ _splat: environmentId }}>
      {environmentId}
    </Link>
  );
  if (story.verdict !== null)
    return (
      <VerdictStep
        verdict={story.verdict}
        environment={environment}
        revision={revision}
      />
    );
  const fix = story.caused ? "Fix the cause," : NO_CAUSE;
  switch (story.next) {
    case "recover": {
      return (
        <>
          <p>
            Operator recovery is required. A change may still be running outside
            Delivery. It must be checked before this environment unlocks.
          </p>
          <p>
            {story.intent === null ? (
              "No inspection has been requested yet: an administrator requests a recovery intent, and the lock holds until an independent reader settles it."
            ) : (
              <>
                <Link
                  to="/recovery-intents/$"
                  params={{ _splat: story.intent.id }}
                >
                  Recovery intent {story.intent.sequence}
                </Link>{" "}
                is {story.intent.outcome.replaceAll("_", " ")}; the lock holds
                until it is settled.
              </>
            )}
          </p>
        </>
      );
    }
    case "retry": {
      return (
        <p>
          {fix} then retry it as a new deployment, or request another release
          from {environment}.
        </p>
      );
    }
    case "request": {
      return (
        <p>
          {fix} then request another release from {environment}.
        </p>
      );
    }
  }
}

/**
 * Why a canceled release a newer acceptance superseded, or a newer request
 * holds, offers no retry. A failed one says so under why it failed.
 */
export function SupersededNote({ detail }: { detail: Detail }) {
  const verdict = deploymentVerdict(detail);
  if (
    explainsFailure(detail.deployment) ||
    (verdict?.kind !== "superseded" && verdict?.kind !== "queued")
  )
    return null;
  return (
    <div className="notice">
      <VerdictStep
        verdict={verdict}
        environment={
          <Link to="/environments/$" params={{ _splat: detail.environment.id }}>
            {detail.environment.id}
          </Link>
        }
        revision={releaseName(detail)}
      />
    </div>
  );
}

/** This deployment's release as the page names it: "r348". */
function releaseName(detail: Detail) {
  return detail.versionSet === undefined
    ? "this release"
    : revisionLabel(detail.versionSet.revision);
}

/**
 * What the records say caused the failure: the message, the step, its last
 * evidence and what recovery read back. Work recovery read back as finished
 * explains nothing, so that follows the step the deployment ended on.
 */
function FailureCause({ story }: { story: Story }) {
  const readback =
    story.settled === null ? null : <SettledHeadline settled={story.settled} />;
  return (
    <>
      {story.message !== null && (
        <p className="failure-message">{story.message}</p>
      )}
      {!story.readbackFinished && readback}
      {story.step !== null && (
        <StepSentence step={story.step} settled={story.settled !== null} />
      )}
      {story.evidence !== null && (
        <p>
          Last evidence
          {story.evidence.from === null
            ? " reported with the result"
            : ` from ${story.evidence.from}`}
          : {story.evidence.text}
        </p>
      )}
      {story.readbackFinished && !story.caused && <p>{NO_CAUSE_RECORDED}.</p>}
      {story.readbackFinished && readback}
    </>
  );
}

/** The top of a failed or locked deployment: why, and what the operator can do next. */
export function WhyItFailed({ detail }: { detail: Detail }) {
  const story = failureStory(detail);
  if (story === null) return null;
  // Once a newer acceptance or recovery settled it, the records' own
  // instructions are stale: nothing is left to fix.
  const settledByVerdict =
    story.verdict?.kind === "superseded" || story.verdict?.kind === "recovered";
  return (
    <section
      className={
        story.verdict?.kind === "recovered" ? "panel" : "panel panel-failed"
      }
      aria-labelledby="failure-heading"
    >
      <h2 id="failure-heading">{story.heading}</h2>
      <FailureCause story={story} />
      <h3>What you can do</h3>
      {!settledByVerdict && story.remedies.length > 0 && (
        <ul className="failure-remedies">
          {story.remedies.map((remedy) => (
            <li key={remedy}>{remedy}</li>
          ))}
        </ul>
      )}
      {!settledByVerdict && story.pointers.length > 0 && (
        <dl className="failure-pointers">
          {story.pointers.map((pointer) => (
            <div key={pointer.label}>
              <dt>{pointer.label}</dt>
              <dd>
                <CopyableIdentifier
                  label={pointer.label}
                  value={pointer.value}
                />
              </dd>
            </div>
          ))}
        </dl>
      )}
      <NextStep
        story={story}
        environmentId={detail.environment.id}
        revision={releaseName(detail)}
      />
    </section>
  );
}
