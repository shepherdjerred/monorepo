import type { Environment } from "#src/configuration.ts";

/**
 * Whether Scout may start a coach turn on its own from live game state.
 *
 * Riot's published policy prohibits unprompted alerts from live game state,
 * so a proactive turn (`coach/triggers`, initiation `app_proactive`) is a
 * beta-only experiment and production refuses it outright. The environment
 * is checked first and alone: no flag, provider answer or registry override is
 * consulted in production, and the route asks this before it reads a flag.
 * `scout_coach_proactive` is also on the production hard-disable list in
 * `configuration/flags.ts`, so any other reader of the flag sees `false`
 * there too.
 *
 * Outside production a proactive turn needs all three coach flags: the master
 * switch, the live-state kill switch it shares with player-asked turns, and
 * `scout_coach_proactive` itself.
 *
 * Pure: the caller resolves the environment and the flags.
 */

export type ProactiveFlags = {
  /** `scout_desktop_coach`. */
  readonly coachEnabled: boolean;
  /** `scout_coach_live_answers`, the Riot kill switch for live state. */
  readonly liveAnswersEnabled: boolean;
  /** `scout_coach_proactive`. */
  readonly proactiveEnabled: boolean;
};

export type ProactiveRefusal =
  | "production"
  | "coach_disabled"
  | "live_answers_disabled"
  | "proactive_disabled";

export type ProactiveDecision =
  | { readonly admitted: true }
  | { readonly admitted: false; readonly reason: ProactiveRefusal };

/** Production refuses before anything else is read. */
export function proactiveRefusedIn(environment: Environment): boolean {
  return environment === "prod";
}

export function decideProactiveTurn(
  environment: Environment,
  flags: ProactiveFlags,
): ProactiveDecision {
  if (proactiveRefusedIn(environment)) {
    return { admitted: false, reason: "production" };
  }
  if (!flags.coachEnabled) return { admitted: false, reason: "coach_disabled" };
  if (!flags.liveAnswersEnabled) {
    return { admitted: false, reason: "live_answers_disabled" };
  }
  return flags.proactiveEnabled
    ? { admitted: true }
    : { admitted: false, reason: "proactive_disabled" };
}
