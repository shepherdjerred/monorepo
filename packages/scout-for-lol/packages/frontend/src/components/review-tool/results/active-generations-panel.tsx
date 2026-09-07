/**
 * Active generations panel showing in-progress generations
 */
import { PipelinePillProgress } from "./generation-progress.tsx";

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
    <div className="bg-scout-surface rounded-lg border border-scout-border p-4">
      <h3 className="text-lg font-bold text-scout-ink mb-3">
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
                  ? "border-scout-brand bg-scout-raised"
                  : "border-scout-warning bg-scout-warning hover:bg-scout-warning"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-scout-warning" />
                  <span className="text-scout-warning text-xs font-semibold">
                    GENERATING
                  </span>
                </div>
                <span className="text-xs text-scout-subtle tabular-nums">
                  {elapsedSeconds}s
                </span>
              </div>
              <PipelinePillProgress
                currentStage={currentStage}
                totalStages={totalStages}
                isComplete={false}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
