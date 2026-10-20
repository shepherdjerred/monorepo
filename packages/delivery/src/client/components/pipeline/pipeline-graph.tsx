import type { PipelineStage } from "#shared/hub/hub-contract.ts";
import { StageCard, TransitionMarker } from "./stage-card.tsx";

/**
 * The pipeline as an ordered list: stages read in order by assistive
 * technology, scroll horizontally on wide screens and stack on narrow ones.
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
        {stages.map((stage) => (
          <li key={stage.key} className="pipeline-step">
            {stage.transition !== null && (
              <TransitionMarker transition={stage.transition} />
            )}
            <StageCard stage={stage} />
          </li>
        ))}
      </ol>
    </div>
  );
}
