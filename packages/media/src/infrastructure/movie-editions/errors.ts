import { MediaError } from "#application/errors.ts";

/** Expected loss of movie acquisition authority, including after acknowledged effects. */
export class MovieChoiceProtection extends MediaError {
  constructor(
    code: "movie_edition_choice_required" | "movie_edition_choice_changed",
  ) {
    super(
      code,
      code === "movie_edition_choice_required"
        ? "Choose a movie edition before acquiring a new copy"
        : "The movie attempt's original choice no longer authorizes new effects",
      409,
    );
  }
}
