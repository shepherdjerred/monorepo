import type { MovieHistoryDeclarationV3 } from "#shared/movie-editions/history-review-v3.ts";

export type Intent = MovieHistoryDeclarationV3["intent"];

/** What a person can declare for a cut, and what each declaration records. */
export const INTENT_COPY = {
  request: {
    option: "I request this edition using my captured choice",
    consequence: "Records the choice this review captured as what you want.",
  },
  keep: {
    option: "Keep this edition using my captured choice and hold",
    consequence:
      "Records your choice and the Keep or pin you pick next as what you want.",
  },
  no_longer_request: {
    option: "I no longer request this edition",
    consequence: "Records that you no longer want this edition.",
  },
} as const satisfies Record<Intent, { option: string; consequence: string }>;

const INTENTS = [
  "request",
  "keep",
  "no_longer_request",
] as const satisfies readonly Intent[];

/** The declaration a radio's value names; any other is a broken page. */
export function intentOf(value: string): Intent {
  const found = INTENTS.find((intent) => intent === value);
  if (found === undefined) throw new Error("Unknown history declaration");
  return found;
}
