import type { MatchMvpCategory } from "#src/mvp-votes/custom-id.ts";

export const MVP_VOTE_GUILD_ONLY = "MVP voting only works inside a server.";

export const MVP_VOTE_NOT_ENABLED = "MVP voting is not enabled in this server.";

export const MVP_VOTE_NOT_ELIGIBLE =
  "You can vote only if you played in this game and your Discord is linked to the player who played.";

export const MVP_VOTE_NO_CONTEST = "This game is not open for MVP votes.";

export const MVP_VOTE_SELECT_PLACEHOLDER = "Pick any player";

export const MVP_TALLY_TITLE = "MVP votes";
export const MVP_TALLY_EMPTY = "No votes yet";

export const MVP_JUSTIFICATION_FIELD_ID = "justification";
export const MVP_JUSTIFICATION_MAX_LENGTH = 200;

export function voteButtonLabel(category: MatchMvpCategory): string {
  return category === "ally" ? "Vote my team MVP" : "Vote enemy MVP";
}

export function voteModalTitle(category: MatchMvpCategory): string {
  return category === "ally" ? "Why this MVP?" : "Why this enemy MVP?";
}

export function voteConfirmation(input: {
  category: MatchMvpCategory;
  nomineeLabel: string;
  justification: string | null;
}): string {
  const heading =
    input.category === "ally"
      ? `Voted **${input.nomineeLabel}** as my team MVP.`
      : `Voted **${input.nomineeLabel}** as the enemy MVP.`;
  return input.justification === null
    ? heading
    : `${heading}\n> ${input.justification}`;
}
