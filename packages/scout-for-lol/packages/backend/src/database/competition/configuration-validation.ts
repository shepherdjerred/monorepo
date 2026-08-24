import {
  CompetitionConfigurationSchema,
  type CompetitionCriteria,
  type CompetitionGameVariant,
} from "@scout-for-lol/data";
import {
  browserClassicChampions,
  browserModernChampions,
} from "@scout-for-lol/data/browser-assets";

/** Validate queue/variant compatibility and the variant-specific champion catalog. */
export function validateCompetitionConfiguration(
  criteria: CompetitionCriteria,
  gameVariant: CompetitionGameVariant,
): void {
  CompetitionConfigurationSchema.parse({ criteria, gameVariant });
  if (criteria.type !== "MOST_WINS_CHAMPION") return;

  const catalog =
    gameVariant === "MODERN" ? browserModernChampions : browserClassicChampions;
  if (!catalog.some((champion) => champion.id === criteria.championId)) {
    throw new Error(
      `Champion ${criteria.championId.toString()} is not available in ${gameVariant === "MODERN" ? "Modern League" : "League Classic"}.`,
    );
  }
}
