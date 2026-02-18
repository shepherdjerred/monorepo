/**
 * Active generations panel showing in-progress generations
 */
type ActiveGeneration = {
  id: string;
  progress?: {
    step: string;
    message?: string;
    currentStage?: number;
    totalStages?: number;
  };
  startTime: number;
};

type ActiveGenerationsPanelProps = {
  activeGenerations: Map<string, ActiveGeneration>;
  activeGenerationTimers: Map<string, number>;
  selectedHistoryId: string | undefined;
  onSelectGeneration: (id: string) => void;
};

type StageStatus = "complete" | "active" | "pending";

/** Pill-style progress bar with 5 connected segments */
function PipelinePillProgress({
  currentStage,
  totalStages,
}: {
  currentStage: number;
  totalStages: number;
}) {
  const stages = 5;

  return (
    <div className="flex gap-0.5 mt-2">
      {Array.from({ length: stages }).map((_, index) => {
        let status: StageStatus = "pending";
        if (index < currentStage) {
          status = "complete";
        } else if (index === currentStage) {
          status = "active";
        }
        // If this stage is beyond totalStages, it's skipped
        if (index >= totalStages) {
          status = "pending";
        }

        return (
          <div
            key={index}
            className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
              status === "complete"
                ? "bg-green-500"
                : (status === "active"
                  ? "bg-yellow-500 animate-pulse"
                  : "bg-surface-200")
            }`}
          />
        );
      })}
    </div>
  );
}

export function ActiveGenerationsPanel({
  activeGenerations,
  activeGenerationTimers,
  selectedHistoryId,
  onSelectGeneration,
}: ActiveGenerationsPanelProps) {
  if (activeGenerations.size === 0) {
    return null;
  }

  return (
    <div className="bg-white rounded-lg border border-surface-200 p-4">
      <h3 className="text-lg font-bold text-surface-900 mb-3">
        In Progress ({activeGenerations.size})
      </h3>
      <div className="space-y-2">
        {[...activeGenerations.values()].map((gen) => {
          const isSelected = gen.id === selectedHistoryId;
          const elapsed = activeGenerationTimers.get(gen.id) ?? 0;
          const elapsedSeconds = Math.floor(elapsed / 1000);

          // Determine current stage from progress
          const currentStage = gen.progress?.currentStage ?? 0;
          const totalStages = gen.progress?.totalStages ?? 5;

          return (
            <button
              key={gen.id}
              onClick={() => {
                onSelectGeneration(gen.id);
              }}
              className={`w-full text-left p-3 rounded border transition-colors ${
                isSelected
                  ? "border-blue-500 bg-blue-50"
                  : "border-yellow-200 bg-yellow-50 hover:bg-yellow-100"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-yellow-600" />
                  <span className="text-yellow-600 text-xs font-semibold">
                    GENERATING
                  </span>
                </div>
                <span className="text-xs text-surface-500 tabular-nums">
                  {elapsedSeconds}s
                </span>
              </div>
              <PipelinePillProgress
                currentStage={currentStage}
                totalStages={totalStages}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
