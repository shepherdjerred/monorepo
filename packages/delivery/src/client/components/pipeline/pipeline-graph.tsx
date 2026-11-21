import { Link } from "@tanstack/react-router";
import type { PipelineStage } from "#shared/hub/hub-contract.ts";
import { StageCard, TransitionMarker } from "./stage-card.tsx";
import {
  environmentStanding,
  type EnvironmentStanding,
} from "./environment-standing.ts";

/**
 * An environment stage's status line. A newer release that waits for a
 * person links to the environment, where the release form is.
 */
function StandingLine({
  standing,
  environmentId,
}: {
  standing: EnvironmentStanding;
  environmentId: string;
}) {
  const { facts, ready } = standing;
  return (
    <p className="stage-standing">
      {facts.join(" · ")}
      {ready !== null && (
        <>
          {" · "}
          {ready.waitsForPerson ? (
            <Link to="/environments/$" params={{ _splat: environmentId }}>
              {ready.text}
            </Link>
          ) : (
            ready.text
          )}
        </>
      )}
    </p>
  );
}

/**
 * The pipeline as an ordered list: stages read in order by assistive
 * technology, share the width on wide screens and stack on narrow ones. The
 * region scrolls, and takes keyboard focus to do it, only when a pipeline has
 * more stages than the width holds.
 */
export function PipelineGraph({
  label,
  stages,
}: {
  label: string;
  stages: PipelineStage[];
}) {
  return (
    <div
      className="pipeline-scroll"
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      <ol className="pipeline">
        {stages.map((stage) => {
          const standing = environmentStanding(stage, stages);
          return (
            <li key={stage.key} className="pipeline-step">
              {stage.transition !== null && (
                <TransitionMarker transition={stage.transition} />
              )}
              <StageCard
                stage={stage}
                standing={
                  standing !== null &&
                  stage.environmentId !== null && (
                    <StandingLine
                      standing={standing}
                      environmentId={stage.environmentId}
                    />
                  )
                }
              />
            </li>
          );
        })}
      </ol>
    </div>
  );
}
