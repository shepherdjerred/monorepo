import {
  COACH_APP_INITIATION_SECTION,
  COACH_APP_INITIATIONS,
  COACH_SERVER_INITIATION_SECTION,
  COACH_SERVER_INITIATIONS,
  COACH_CONTEXT_SECTIONS,
  CoachGameContextSchema,
  type CoachContextSection,
  type CoachGameContext,
} from "@scout-for-lol/data";
import { z } from "zod";

/**
 * The server's gate on the game context a coach turn carries.
 *
 * The client attaches a snapshot to each turn and the server keeps no live
 * state between requests, so this is the one place that decides what of it
 * the agent may see. Two independent rules:
 *
 * 1. The allowlist. `CoachGameContextSchema` is strict at every level, so a
 *    key it does not name (a Riot ID, a cooldown, a position, the enemy ward
 *    score) refuses the whole context rather than being dropped quietly: a
 *    client that sends one is broken, and the caller answers a typed 400.
 * 2. The policy. `live` passes only on a turn the player started, with
 *    `scout_coach_live_answers` on; every section needs `scout_desktop_coach`.
 *    A section the policy withholds is dropped, recorded with its reason, and
 *    the turn is answered without it.
 *
 * Riot's published policy approves pre-game, champion-select options and
 * post-game review, prohibits unprompted alerts from live state, and does not
 * address answering a question the player asked from scoreboard-visible
 * state. So live state reaches the agent when the player asked, while the
 * kill switch is on, and otherwise only on a beta-only proactive turn that
 * `coach/proactive-policy.ts` admitted, which it never does in production.
 *
 * Pure: the caller resolves the flags and proves the initiation.
 */

/**
 * How a turn began. A new member is not player-initiated until it is added
 * to `PLAYER_INITIATIONS` with the proof that earns it.
 *
 * - `player_typed`: free text the player typed in the composer, sent as the
 *   turn's question (`runs/start` with a non-null `question`).
 * - `player_voice`: a question the player spoke (`coach/voice/turns`). The
 *   route takes audio only and the server transcribes it itself, so the
 *   question is what the player said, not text a client chose; a wake-word
 *   turn must also open with the wake phrase in that transcript
 *   (`verifyWakeTranscript`). It is treated exactly as `player_typed`.
 * - `app_champ_select`: Scout asked for advice because a pick or ban changed
 *   (`COACH_APP_INITIATIONS`). Carries only `champSelect`.
 * - `app_pregame`: Scout asked for the plan at the start of a game. Carries
 *   only `pregame`.
 *
 * - `app_postgame`: the server started the post-game review once the game's
 *   recording and resolved match were stored (`COACH_SERVER_INITIATIONS`; no
 *   client route can start it). Carries only `postgame`.
 * - `app_proactive`: Scout Desktop's beta build asked for a turn because a
 *   scoreboard detector fired (`coach/triggers`). Carries only `live`, and
 *   only with `proactiveEnabled`, which `coach/proactive-policy.ts` grants
 *   outside production alone.
 *
 * Only `app_proactive` among the app initiations carries `live`, and only when
 * the proactive policy admits it: the gate withholds `live` from every other
 * app initiation, and the app route refuses a request that names it.
 */
export const COACH_PROACTIVE_INITIATION = "app_proactive";
export const CoachTurnInitiationSchema = z.enum([
  "player_typed",
  "player_voice",
  ...COACH_APP_INITIATIONS,
  ...COACH_SERVER_INITIATIONS,
  COACH_PROACTIVE_INITIATION,
]);
export type CoachTurnInitiation = z.infer<typeof CoachTurnInitiationSchema>;

export const PLAYER_INITIATIONS: ReadonlySet<CoachTurnInitiation> =
  new Set<CoachTurnInitiation>(["player_typed", "player_voice"]);

export type CoachPolicyFlags = {
  /** `scout_desktop_coach`, the master switch. */
  readonly coachEnabled: boolean;
  /** `scout_coach_live_answers`, the Riot kill switch for live state. */
  readonly liveAnswersEnabled: boolean;
  /**
   * Whether `coach/proactive-policy.ts` admitted a proactive turn: never in
   * production, otherwise `scout_coach_proactive`. Absent is off, so no
   * caller that predates proactive turns can let one through.
   */
  readonly proactiveEnabled?: boolean;
};

export type CoachWithheldReason =
  | "coach_disabled"
  | "not_player_initiated"
  | "section_outside_initiation"
  | "proactive_disabled"
  | "live_answers_disabled";

export type CoachContextProjection = {
  /** What the agent may see; null when every section was withheld. */
  readonly context: CoachGameContext | null;
  /** The sections the client sent, in contract order. */
  readonly present: readonly CoachContextSection[];
  /** The sections that passed, in contract order. */
  readonly accepted: readonly CoachContextSection[];
  readonly withheld: readonly {
    readonly section: CoachContextSection;
    readonly reason: CoachWithheldReason;
  }[];
};

export type CoachContextResult =
  | { readonly ok: true; readonly projection: CoachContextProjection }
  | { readonly ok: false; readonly issues: readonly string[] };

const INITIATION_SECTION = {
  ...COACH_APP_INITIATION_SECTION,
  ...COACH_SERVER_INITIATION_SECTION,
  [COACH_PROACTIVE_INITIATION]: "live",
} as const satisfies Record<
  Exclude<CoachTurnInitiation, "player_typed" | "player_voice">,
  CoachContextSection
>;

/** Why a section may not reach the agent on this turn, or null when it may. */
function withheldReason(
  section: CoachContextSection,
  initiation: CoachTurnInitiation,
  flags: CoachPolicyFlags,
): CoachWithheldReason | null {
  if (!flags.coachEnabled) return "coach_disabled";
  if (section === "live") return liveWithheldReason(initiation, flags);
  // An app-started turn carries the one section it exists for and no other;
  // a typed or spoken question carries any.
  return initiation !== "player_typed" &&
    initiation !== "player_voice" &&
    INITIATION_SECTION[initiation] !== section
    ? "section_outside_initiation"
    : null;
}

function liveWithheldReason(
  initiation: CoachTurnInitiation,
  flags: CoachPolicyFlags,
): CoachWithheldReason | null {
  if (initiation === COACH_PROACTIVE_INITIATION) {
    if (flags.proactiveEnabled !== true) return "proactive_disabled";
  } else if (!PLAYER_INITIATIONS.has(initiation)) {
    return "not_player_initiated";
  }
  return flags.liveAnswersEnabled ? null : "live_answers_disabled";
}

/**
 * Hold a raw game context to the allowlist, then to the coach policy.
 *
 * Refuses (`ok: false`, with each issue's path) a context that breaks the
 * contract, whatever the flags say: an unknown key is a broken client, not a
 * section to withhold.
 */
export function projectGameContext(
  raw: unknown,
  options: {
    readonly initiation: CoachTurnInitiation;
    readonly flags: CoachPolicyFlags;
  },
): CoachContextResult {
  const parsed = CoachGameContextSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) =>
        issue.path.length === 0 ? issue.message : issue.path.join("."),
      ),
    };
  }
  const present = COACH_CONTEXT_SECTIONS.filter(
    (section) => parsed.data[section] !== undefined,
  );
  const withheld = present.flatMap((section) => {
    const reason = withheldReason(section, options.initiation, options.flags);
    return reason === null ? [] : [{ section, reason }];
  });
  const accepted = present.filter(
    (section) => !withheld.some((entry) => entry.section === section),
  );
  const context: CoachGameContext = {};
  for (const section of accepted) {
    copySection(context, parsed.data, section);
  }
  return {
    ok: true,
    projection: {
      context: accepted.length === 0 ? null : context,
      present,
      accepted,
      withheld,
    },
  };
}

/** Copy one section, keeping each section's own type. */
function copySection(
  target: CoachGameContext,
  source: CoachGameContext,
  section: CoachContextSection,
): void {
  switch (section) {
    case "champSelect":
      target.champSelect = source.champSelect;
      return;
    case "pregame":
      target.pregame = source.pregame;
      return;
    case "live":
      target.live = source.live;
      return;
    case "postgame":
      target.postgame = source.postgame;
      return;
  }
}
