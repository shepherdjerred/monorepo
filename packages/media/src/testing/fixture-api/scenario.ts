import { z } from "zod";

/**
 * A condition the fixture API can be put in, for the states a page only
 * shows when something outside it is wrong. `default` is everything working.
 *
 * - `stale-library-access`: Media could not confirm the reader's Plex access,
 *   so no catalog title says what the household has of it.
 * - `feed-unavailable`: one discover feed answers 502 while the others, and
 *   search, keep working.
 * - `catalog-unavailable`: TMDB is down, so every catalog read answers 502.
 * - `new-household`: nobody has asked for or watched anything yet, so the
 *   calendar has no releases on it, dated or not, nothing is playing, and
 *   the watch history is empty.
 */
export const FixtureScenarioSchema = z.enum([
  "default",
  "stale-library-access",
  "feed-unavailable",
  "catalog-unavailable",
  "new-household",
]);
export type FixtureScenario = z.infer<typeof FixtureScenarioSchema>;

/** Cookie that selects the scenario for one browser. */
export const SCENARIO_COOKIE = "media-fixture-scenario";

/**
 * An answer that is an error the real API sends on purpose, such as a 502
 * when an upstream is down. A fixture throws it; the router turns it into
 * the typed error body.
 */
export class FixtureFailure extends Error {
  readonly status: 502;
  readonly code: string;

  constructor(status: 502, code: string, message: string) {
    super(message);
    this.name = "FixtureFailure";
    this.status = status;
    this.code = code;
  }
}
