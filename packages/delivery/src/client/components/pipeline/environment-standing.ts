import type { PipelineStage, Transition } from "#shared/hub/hub-contract.ts";
import { revisionLabel } from "#client/components/identifier.tsx";

/** How the release waiting for an environment would reach it. */
function arrival(transition: Transition | null) {
  if (transition === null) return "release by hand";
  switch (transition.mode) {
    case "approval": {
      return "needs approval";
    }
    case "automatic": {
      return transition.enabled
        ? "deploys automatically"
        : "automatic deploys paused";
    }
    case "promotion": {
      return "promote by hand";
    }
    case "manual": {
      return "release by hand";
    }
  }
}

/** What the newest deployment is doing with a release the environment has not accepted. */
function newestOutcome(stage: PipelineStage) {
  switch (stage.status) {
    case "running":
    case "queued":
    case "pending": {
      return "deploying";
    }
    case "awaiting_approval": {
      return "waiting for approval";
    }
    case "failed": {
      return "failed";
    }
    case "canceled": {
      return "canceled";
    }
    case "succeeded":
    case "not_started": {
      return null;
    }
  }
}

/**
 * The newest release an environment could take next: what its promotion
 * source has accepted, or else the newest composed release.
 */
function offered(stage: PipelineStage, stages: readonly PipelineStage[]) {
  const source = stage.transition?.sourceEnvironmentId ?? null;
  const offering =
    source === null
      ? stages.find((candidate) => candidate.kind === "version")?.execution
      : stages.find((candidate) => candidate.environmentId === source)
          ?.accepted;
  return offering?.revision ?? null;
}

/** An environment stage's status line: what it runs, and the release ready for it. */
export type EnvironmentStanding = {
  /** What it runs, then what its newest deployment did with another release. */
  facts: string[];
  /** A newer release it could take, and whether that waits for a person. */
  ready: { text: string; waitsForPerson: boolean } | null;
};

/**
 * One line under an environment stage's heading, from what the promotion
 * page already loads: the release it runs ("Running r274"), what its newest
 * deployment is doing when that is another release ("r293 canceled"), and
 * whether a newer release is ready for it ("r322 ready · needs approval") or
 * it is up to date. Null for any other stage, and on a change's path, which
 * does not carry the accepted release.
 */
export function environmentStanding(
  stage: PipelineStage,
  stages: readonly PipelineStage[],
): EnvironmentStanding | null {
  if (stage.kind !== "environment" || stage.accepted === undefined) return null;
  const running = stage.accepted?.revision ?? null;
  const facts = [
    running === null
      ? "Nothing deployed yet"
      : `Running ${revisionLabel(running)}`,
  ];
  const newest = stage.execution?.revision ?? null;
  const outcome = newestOutcome(stage);
  if (newest !== null && newest !== running && outcome !== null)
    facts.push(`${revisionLabel(newest)} ${outcome}`);
  const next = offered(stage, stages);
  if (next === null || next <= (running ?? 0))
    return {
      facts: running === null ? facts : [...facts, "up to date"],
      ready: null,
    };
  if (next === newest) {
    // A deployment of that release under way already says where it stands.
    if (outcome !== "failed" && outcome !== "canceled")
      return { facts, ready: null };
    // After a failure or a cancellation Delivery does not deploy that same
    // release again on its own, whatever the transition says, so it waits for
    // a person to retry it or release it by hand.
    return {
      facts,
      ready: {
        text: `${revisionLabel(next)} will not deploy again on its own · retry or release by hand`,
        waitsForPerson: true,
      },
    };
  }
  const how = arrival(stage.transition);
  return {
    facts,
    ready: {
      text: `${revisionLabel(next)} ready · ${how}`,
      waitsForPerson: how !== "deploys automatically",
    },
  };
}
