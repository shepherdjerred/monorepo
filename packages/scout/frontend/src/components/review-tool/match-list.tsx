/**
 * Match list display component
 */
import type { MatchMetadata } from "@shepherdjerred/scout-frontend/lib/review-tool/match-converter";

type MatchListProps = {
  matches: MatchMetadata[];
  selectedMetadata: MatchMetadata | null;
  filterPlayer: string;
  filterChampion: string;
  filterQueueType: string;
  filterLane: string;
  filterOutcome: string;
  onSelectMatch: (metadata: MatchMetadata) => void;
};

export function MatchList({
  matches,
  selectedMetadata,
  filterPlayer,
  filterChampion,
  filterQueueType,
  filterLane,
  filterOutcome,
  onSelectMatch,
}: MatchListProps) {
  return (
    <div
      className="max-h-96 overflow-y-auto"
      key={`results-${filterPlayer}-${filterChampion}-${filterQueueType}-${filterLane}-${filterOutcome}`}
    >
      <div className="space-y-2 p-2">
        {matches.map((match, idx) => {
          const isSelected =
            selectedMetadata !== null &&
            selectedMetadata.key === match.key &&
            selectedMetadata.playerName === match.playerName;
          return (
            <div
              key={`${match.key}-${match.playerName}-${idx.toString()}`}
              role="button"
              tabIndex={0}
              onClick={() => {
                onSelectMatch(match);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectMatch(match);
                }
              }}
              className={`rounded p-2 transition-colors cursor-pointer ${
                isSelected
                  ? "bg-brand-100 border-2 border-brand-500"
                  : "bg-surface-50 hover:bg-surface-100 border-2 border-transparent"
              }`}
            >
              <div className="flex justify-between items-start mb-1">
                <div className="flex items-center gap-2">
                  <div className="text-xs font-medium text-surface-900">{match.champion}</div>
                  <div className="text-xs text-surface-500">({match.lane})</div>
                </div>
                {isSelected && <div className="text-xs font-semibold text-brand-600">✓ Selected</div>}
              </div>
              <div className="text-xs text-surface-600 space-y-0.5">
                <div>{match.playerName}</div>
                <div className="flex justify-between">
                  <span className="capitalize">{match.queueType}</span>
                  <span
                    className={
                      match.outcome.includes("Victory")
                        ? "text-green-600"
                        : match.outcome.includes("Defeat")
                          ? "text-red-600"
                          : ""
                    }
                  >
                    {match.outcome}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="font-mono">{match.kda}</span>
                  <span>{match.timestamp.toLocaleDateString()}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
