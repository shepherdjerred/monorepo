/**
 * Generation progress indicator
 *
 * Shows a dynamic pill progress bar that adapts to the number of pipeline stages.
 */
import type { GenerationProgress as GenerationProgressType } from "@scout-for-lol/frontend/lib/review-tool/generator";

type GenerationProgressProps = {
  progress: GenerationProgressType;
  elapsedMs: number;
};

export type StageStatus = "complete" | "active" | "pending";

/** Pill-style progress bar with connected segments based on total stages */
export function PipelinePillProgress({
  currentStage,
  totalStages,
  isComplete,
}: {
  currentStage: number;
  totalStages: number;
  isComplete: boolean;
}) {
  return (
    <div className="flex gap-1">
      {Array.from({ length: totalStages }).map((_, index) => {
        let status: StageStatus = "pending";
        if (isComplete || index < currentStage) {
          status = "complete";
        } else if (index === currentStage) {
          status = "active";
        }

        return (
          <div
            key={index}
            className={`h-2 flex-1 rounded-full transition-all duration-300 ${
              status === "complete"
                ? "bg-green-500"
                : status === "active"
                  ? "bg-yellow-500 animate-pulse"
                  : "bg-surface-200"
            }`}
          />
        );
      })}
    </div>
  );
}

export function GenerationProgress({
  progress,
  elapsedMs,
}: GenerationProgressProps) {
  const { step, message, currentStage, totalStages, chunkIndex, chunkTotal } =
    progress;

  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  const isComplete = step === "complete";

  // Build display message with chunk info if applicable
  let displayMessage = message;
  if (
    chunkIndex !== undefined &&
    chunkTotal !== undefined &&
    step === "timeline-chunk"
  ) {
    displayMessage = `Processing timeline (${chunkIndex.toString()}/${chunkTotal.toString()})...`;
  }

  return (
    <div className="mb-4 p-4 bg-brand-50 border border-brand-200 rounded-xl">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Spinning loader */}
            {!isComplete && (
              <div className="shrink-0">
                <svg
                  className="animate-spin h-5 w-5 text-brand-600"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
              </div>
            )}
            {isComplete && (
              <div className="shrink-0">
                <svg
                  className="h-5 w-5 text-victory-500"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
            )}
            <div className="flex-1">
              <div className="text-sm font-medium text-brand-900">
                {isComplete ? "Complete!" : displayMessage}
              </div>
            </div>
          </div>
          <div className="text-sm font-mono text-brand-700">
            {elapsedSeconds}s
          </div>
        </div>

        {/* 5-stage pill progress bar */}
        <PipelinePillProgress
          currentStage={currentStage ?? 0}
          totalStages={totalStages ?? 5}
          isComplete={isComplete}
        />
      </div>
    </div>
  );
}
