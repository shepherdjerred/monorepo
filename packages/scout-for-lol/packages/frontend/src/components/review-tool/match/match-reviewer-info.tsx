/**
 * Display selected match and reviewer info
 */
import type { CompletedMatch, ArenaMatch } from "@scout-for-lol/data";
import { championNameToDisplayName } from "@scout-for-lol/data";
import { ChampionPortrait } from "@scout-for-lol/design-system/assets";
import type { ReviewConfig } from "#src/lib/review-tool/config/schema.ts";

/**
 * Helper to get match display info - properly narrows types
 */
function getMatchDisplayInfo(match: CompletedMatch | ArenaMatch) {
  const player = match.players[0];
  if (!player) {
    return {
      alias: "Unknown",
      champion: "???",
      outcomeText: "",
      outcomeClass: "text-scout-subtle",
    };
  }

  const alias = player.playerConfig.alias;
  const champion = championNameToDisplayName(player.champion.championName);

  if (match.queueType === "arena") {
    const arenaPlayer = player;
    if ("placement" in arenaPlayer) {
      const placement = arenaPlayer.placement;
      const outcomeText = `#${String(placement)}`;
      const outcomeClass =
        placement === 1
          ? "text-scout-warning"
          : placement === 8
            ? "text-scout-danger"
            : "text-scout-subtle";
      return { alias, champion, outcomeText, outcomeClass };
    }
    return {
      alias,
      champion,
      outcomeText: "",
      outcomeClass: "text-scout-subtle",
    };
  }

  // Regular match
  if ("outcome" in player) {
    const outcome = player.outcome;
    const outcomeClass =
      outcome === "Victory"
        ? "text-scout-warning"
        : outcome === "Defeat"
          ? "text-scout-danger"
          : "text-scout-subtle";
    return { alias, champion, outcomeText: outcome, outcomeClass };
  }

  return {
    alias,
    champion,
    outcomeText: "",
    outcomeClass: "text-scout-subtle",
  };
}

/**
 * Display selected match details
 */
function SelectedMatchDisplay(props: { match: CompletedMatch | ArenaMatch }) {
  const { match } = props;
  const info = getMatchDisplayInfo(match);
  const champion = match.players[0]?.champion.championName ?? "unknown";

  return (
    <div className="flex items-center gap-3">
      <ChampionPortrait
        champion={champion}
        alt={`${info.champion} portrait`}
        optional
        className="h-10 w-10 rounded-lg"
      />
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-scout-ink truncate">
          {info.alias}
        </div>
        <div className="text-xs text-scout-subtle flex items-center gap-1.5">
          <span>{info.champion}</span>
          <span className="text-scout-subtle">•</span>
          <span className={info.outcomeClass}>{info.outcomeText}</span>
          {match.queueType && (
            <>
              <span className="text-scout-subtle">•</span>
              <span className="capitalize">
                {match.queueType.replaceAll("_", " ")}
              </span>
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
      <div className="p-3 rounded-lg bg-scout-raised border border-scout-border">
        <div className="text-xs font-medium text-scout-subtle uppercase tracking-wide mb-2">
          Selected Match
        </div>
        {match ? (
          <SelectedMatchDisplay match={match} />
        ) : (
          <div className="text-sm text-scout-subtle italic">
            No match selected
          </div>
        )}
      </div>

      {/* Reviewer */}
      <div className="p-3 rounded-lg bg-scout-raised border border-scout-border">
        <div className="text-xs font-medium text-scout-subtle uppercase tracking-wide mb-2">
          Reviewer
        </div>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-scout-brand text-scout-brand-ink flex items-center justify-center font-bold text-lg">
            {config.prompts.personalityId === "random"
              ? "?"
              : config.prompts.personalityId.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-scout-ink truncate">
              {config.prompts.personalityId === "random"
                ? "Random Personality"
                : config.prompts.personalityId}
            </div>
            <div className="text-xs text-scout-subtle">
              {config.prompts.personalityId === "random"
                ? "Will pick a random reviewer"
                : (config.prompts.customPersonality?.metadata.name ??
                  "Custom personality")}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
