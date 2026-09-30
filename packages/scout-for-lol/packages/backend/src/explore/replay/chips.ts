import {
  EXPLORE_SUGGESTIONS,
  PERSISTENT_EXPLORE_SUGGESTION,
  type ExploreSuggestion,
  type SuggestionCategory,
  type SuggestionCondition,
} from "@scout-for-lol/data";

/**
 * The shipped starter chips, as replay cases.
 *
 * Every prompt in the catalog becomes a case rather than only the ungated
 * ones. A gated chip is not less interesting when its feature is off — it is
 * the more interesting half, because that is where Explore has to say "Scout
 * does not do that here" instead of inventing an answer. Which of the two
 * behaviours is correct is decided per capability profile, not here.
 */

export type ExploreChipCase = {
  /** Stable across catalog reordering, so a baseline run stays comparable. */
  readonly caseId: string;
  readonly prompt: string;
  readonly category: SuggestionCategory;
  readonly condition: SuggestionCondition;
};

/**
 * The pinned chip, which lives outside the catalog.
 *
 * `PERSISTENT_EXPLORE_SUGGESTION` is rendered on every empty Explore screen
 * and is the single most load-bearing prompt in the product: it is the one
 * that has to enumerate what Scout can actually do. Leaving it out because it
 * is not an array entry would drop the case most worth watching.
 */
const PERSISTENT_CHIP: ExploreSuggestion = {
  prompt: PERSISTENT_EXPLORE_SUGGESTION,
  category: "trivia",
  condition: "always",
};

function sha256Hex(text: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(text);
  return hasher.digest("hex");
}

/**
 * A chip's identity is its prompt, not its position.
 *
 * Indices would renumber the whole corpus the first time somebody inserts a
 * question in the middle of the catalog, silently breaking every
 * `--baseline` comparison while appearing to work.
 */
export function chipCaseId(prompt: string): string {
  return `chip:${sha256Hex(prompt).slice(0, 12)}`;
}

export function exploreChipCases(): readonly ExploreChipCase[] {
  return [PERSISTENT_CHIP, ...EXPLORE_SUGGESTIONS].map((suggestion) => ({
    caseId: chipCaseId(suggestion.prompt),
    prompt: suggestion.prompt,
    category: suggestion.category,
    condition: suggestion.condition,
  }));
}

/**
 * Provenance for the manifest: which catalog a run was taken from.
 *
 * Hashes the parsed, canonically-ordered catalog rather than the file bytes,
 * so reformatting the JSON does not read as a corpus change while adding,
 * removing or editing a prompt does.
 */
export function exploreChipCatalogSha256(): string {
  return sha256Hex(JSON.stringify(exploreChipCases()));
}
