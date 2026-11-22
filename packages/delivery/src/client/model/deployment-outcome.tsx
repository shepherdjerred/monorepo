import { Link } from "@tanstack/react-router";
import type { DeploymentDetailV2 } from "#shared/model/contract.ts";
import { groupEvidence, parseEvidenceSummary } from "#client/evidence.ts";
import {
  interrupted,
  recoveryReading,
  stepMessage,
  type RecoveryReading,
} from "#client/deployment-steps.tsx";
import { CopyableIdentifier } from "#client/components/copyable.tsx";
import { retryable } from "./view.ts";

type Detail = Pick<
  DeploymentDetailV2,
  "deployment" | "stages" | "evidence" | "recoveryIntents" | "environment"
>;

/** Whether the page says why this deployment failed or why it holds its lock. */
export function explainsFailure(deployment: {
  status: string;
  recoveryRequired: boolean;
}) {
  return deployment.status === "failed" || deployment.recoveryRequired;
}

/** A step message or a piece of evidence in words: its text, or what kind of receipt it is. */
function spoken(summary: string, kind?: string) {
  const parsed = parseEvidenceSummary(summary);
  if (parsed.kind === "text") return parsed.text;
  if (kind === undefined) return null;
  return parsed.adapter === null
    ? `a ${kind} receipt`
    : `a ${kind} receipt from ${parsed.adapter}`;
}

/**
 * A clause that tells the reader what to do, such as "inspect its recorded
 * UID and bounded stage logs". Executors end a cause with one, and several
 * records of one failure repeat the same one.
 */
const REMEDY = /^(?:inspect|check|retry|fix|re-?run|request|look at|wait) /iu;

/** The clauses of a recorded sentence: split at `;` and at sentence ends. */
function clauses(text: string) {
  return text
    .split(/(?<=[.;])\s+/u)
    .map((part) => part.trim().replace(/[.;]$/u, ""))
    .filter((part) => part !== "");
}

function sentence(text: string) {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

/**
 * Says each clause once across the records of one failure: the deployment's
 * message, its step's message and its last evidence. `say` returns a
 * record's causes not said before, or null when it adds none, and collects
 * its remedies apart, so each instruction appears once under "What you can
 * do".
 */
function sayOnce() {
  const said = new Set<string>();
  const remedies: string[] = [];
  return {
    say(text: string | null) {
      if (text === null) return null;
      const causes: string[] = [];
      for (const clause of clauses(text)) {
        const key = clause.toLowerCase();
        if (said.has(key)) continue;
        said.add(key);
        if (REMEDY.test(clause)) remedies.push(sentence(clause));
        else causes.push(clause);
      }
      return causes.length === 0 ? null : causes.join("; ");
    },
    remedies,
  };
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
function nextStep(deployment: Detail["deployment"]) {
  if (deployment.recoveryRequired) return "recover" as const;
  return retryable(deployment) ? ("retry" as const) : ("request" as const);
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
  return {
    heading:
      deployment.status === "failed" ? "Why it failed" : "Why it is locked",
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
    next: nextStep(deployment),
  };
}

type Story = NonNullable<ReturnType<typeof failureStory>>;

/**
 * What a settled recovery read back, after its intent's name: one
 * operation's phase, each Application's phase when it read several back, or
 * its words when no readback names a phase.
 */
export function settledWords(settled: RecoveryReading) {
  const phased = settled.readbacks.filter((entry) => entry.phase !== null);
  const [only] = settled.readbacks;
  if (phased.length === 0)
    return only === undefined
      ? " settled what the deployment left running."
      : ` settled what the deployment left running: ${only.text}`;
  if (settled.readbacks.length === 1)
    return ` read the external operation back after the deployment ended: it ended in phase ${String(only?.phase)}.`;
  const each = phased
    .map(
      (entry) =>
        `${entry.application ?? "an operation"} ended in phase ${String(entry.phase)}`,
    )
    .join("; ");
  return ` read each external operation back after the deployment ended: ${each}.`;
}

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

function NextStep({
  story,
  environmentId,
}: {
  story: Story;
  environmentId: string;
}) {
  const environment = (
    <Link to="/environments/$" params={{ _splat: environmentId }}>
      {environmentId}
    </Link>
  );
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
          Fix the cause, then retry it as a new deployment, or request another
          release from {environment}.
        </p>
      );
    }
    case "request": {
      return (
        <p>Fix the cause, then request another release from {environment}.</p>
      );
    }
  }
}

/** The top of a failed or locked deployment: why, and what the operator can do next. */
export function WhyItFailed({ detail }: { detail: Detail }) {
  const story = failureStory(detail);
  if (story === null) return null;
  return (
    <section className="panel panel-failed" aria-labelledby="failure-heading">
      <h2 id="failure-heading">{story.heading}</h2>
      {story.message !== null && (
        <p className="failure-message">{story.message}</p>
      )}
      {story.settled !== null && <SettledHeadline settled={story.settled} />}
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
      <h3>What you can do</h3>
      {story.remedies.length > 0 && (
        <ul className="failure-remedies">
          {story.remedies.map((remedy) => (
            <li key={remedy}>{remedy}</li>
          ))}
        </ul>
      )}
      {story.pointers.length > 0 && (
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
      <NextStep story={story} environmentId={detail.environment.id} />
    </section>
  );
}
