/**
 * Display selected match and reviewer info
 */
import type { CompletedMatch, ArenaMatch } from "@shepherdjerred/scout-data";
import type { ReviewConfig } from "@shepherdjerred/scout-frontend/lib/review-tool/config/schema";

/**
 * Helper to get match display info - properly narrows types
 */
function getMatchDisplayInfo(match: CompletedMatch | ArenaMatch) {
  const player = match.players[0];
  if (!player) {
    return { alias: "Unknown", champion: "???", outcomeText: "", outcomeClass: "text-surface-500" };
  }

  const alias = player.playerConfig.alias;
  const champion = player.champion.championName;

  if (match.queueType === "arena") {
    const arenaPlayer = player;
    if ("placement" in arenaPlayer) {
      const placement = arenaPlayer.placement;
      const outcomeText = `#${String(placement)}`;
      const outcomeClass =
        placement === 1 ? "text-victory-600" : placement === 8 ? "text-defeat-600" : "text-surface-500";
      return { alias, champion, outcomeText, outcomeClass };
    }
    return { alias, champion, outcomeText: "", outcomeClass: "text-surface-500" };
  }

  // Regular match
  if ("outcome" in player) {
    const outcome = player.outcome;
    const outcomeClass =
      outcome === "Victory" ? "text-victory-600" : outcome === "Defeat" ? "text-defeat-600" : "text-surface-500";
    return { alias, champion, outcomeText: outcome, outcomeClass };
  }

  return { alias, champion, outcomeText: "", outcomeClass: "text-surface-500" };
}

/**
 * Display selected match details
 */
function SelectedMatchDisplay(props: { match: CompletedMatch | ArenaMatch }) {
  const { match } = props;
  const info = getMatchDisplayInfo(match);

  return (
    <div className="flex items-center gap-3">
      <div className="text-black w-10 h-10 rounded-lg bg-gradient-to-br from-surface-300 to-surface-400 flex items-center justify-center font-bold text-sm">
        {info.champion.slice(0, 2).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-surface-900 truncate">{info.alias}</div>
        <div className="text-xs text-surface-600 flex items-center gap-1.5">
          <span>{info.champion}</span>
          <span className="text-surface-300">•</span>
          <span className={info.outcomeClass}>{info.outcomeText}</span>
          {match.queueType && (
            <>
              <span className="text-surface-300">•</span>
              <span className="capitalize">{match.queueType.replace(/_/g, " ")}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

type MatchAndReviewerInfoProps = {
  match: CompletedMatch | ArenaMatch | undefined;
  config: ReviewConfig;
};

/**
 * Display selected match and reviewer info
 */
export function MatchAndReviewerInfo(props: MatchAndReviewerInfoProps) {
  const { match, config } = props;

  return (
    <div className="mb-4 grid grid-cols-2 gap-4">
      {/* Selected Match */}
      <div className="p-3 rounded-lg bg-surface-50 border border-surface-200">
        <div className="text-xs font-medium text-surface-500 uppercase tracking-wide mb-2">Selected Match</div>
        {match ? (
          <SelectedMatchDisplay match={match} />
        ) : (
          <div className="text-sm text-surface-400 italic">No match selected</div>
        )}
      </div>

      {/* Reviewer */}
      <div className="p-3 rounded-lg bg-surface-50 border border-surface-200">
        <div className="text-xs font-medium text-surface-500 uppercase tracking-wide mb-2">Reviewer</div>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-black font-bold text-lg">
            {config.prompts.personalityId === "random" ? "?" : config.prompts.personalityId.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-surface-900 truncate">
              {config.prompts.personalityId === "random" ? "Random Personality" : config.prompts.personalityId}
            </div>
            <div className="text-xs text-surface-600">
              {config.prompts.personalityId === "random"
                ? "Will pick a random reviewer"
                : (config.prompts.customPersonality?.metadata.name ?? "Custom personality")}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
