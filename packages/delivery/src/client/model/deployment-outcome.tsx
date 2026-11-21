import { Link } from "@tanstack/react-router";
import type { DeploymentDetailV2 } from "#shared/model/contract.ts";
import { groupEvidence, parseEvidenceSummary } from "#client/evidence.ts";
import { interrupted } from "#client/deployment-steps.tsx";
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

/** The step that failed, or was interrupted, in words. */
function stepStory(stage: Detail["stages"][number]) {
  return {
    key: stage.key,
    outcome:
      stage.status === "failed"
        ? ("failed" as const)
        : ("interrupted" as const),
    message: stage.message === "" ? null : spoken(stage.message),
  };
}

/**
 * Why a deployment failed, from what it recorded: its message, the step that
 * failed or was interrupted, the last evidence that step (or the result)
 * recorded, and what the operator can do next. Null for a deployment that
 * neither failed nor holds a recovery lock.
 */
export function failureStory(detail: Detail) {
  const { deployment } = detail;
  if (!explainsFailure(deployment)) return null;
  const stage =
    detail.stages.find((entry) => entry.status === "failed") ??
    detail.stages.find((entry) => interrupted(entry, deployment));
  const groups = groupEvidence(
    deployment.id,
    detail.stages.map((entry) => entry.key),
    detail.evidence,
  );
  const fromStep =
    stage === undefined ? undefined : groups.steps.get(stage.key)?.at(-1);
  const item = fromStep ?? groups.finish[0];
  const evidenceText =
    item === undefined ? null : spoken(item.summary, item.kind);
  const intent = detail.recoveryIntents.toSorted(
    (left, right) => right.sequence - left.sequence,
  )[0];
  return {
    heading:
      deployment.status === "failed" ? "Why it failed" : "Why it is locked",
    message: deployment.message,
    step: stage === undefined ? null : stepStory(stage),
    evidence:
      evidenceText === null
        ? null
        : {
            from: fromStep === undefined ? null : (stage?.key ?? null),
            text: evidenceText,
          },
    locked: deployment.recoveryRequired,
    intent:
      intent === undefined
        ? null
        : { id: intent.id, sequence: intent.sequence, outcome: intent.outcome },
    next: deployment.recoveryRequired
      ? ("recover" as const)
      : retryable(deployment)
        ? ("retry" as const)
        : ("request" as const),
  };
}

type Story = NonNullable<ReturnType<typeof failureStory>>;

function StepSentence({ step }: { step: NonNullable<Story["step"]> }) {
  return (
    <p>
      Step <strong className="mono">{step.key}</strong>{" "}
      {step.outcome === "failed"
        ? "failed"
        : "was still running when the deployment ended, so its outcome is unknown"}
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
      {story.step !== null && <StepSentence step={story.step} />}
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
      <NextStep story={story} environmentId={detail.environment.id} />
    </section>
  );
}
