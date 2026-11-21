import type { Availability, MediaUser } from "#shared/contract.ts";

/**
 * What the reader's own standing with a title allows right now. Every field
 * comes from a read: the page decides nothing the server has not said.
 */
export type TitleFacts = {
  /** Where the household's copy stands; null when the household has none. */
  availability: Availability | null;
  role: MediaUser["role"];
  /** The reader has a standing request for the title. */
  following: boolean;
  /** That request can be withdrawn. */
  canStopFollowing: boolean;
  /** A removal the household can still stop is under way. */
  leavingSoon: boolean;
  /** The reader holds the title for good. */
  kept: boolean;
  /** The reader may hold the title for 30 days. */
  mayHold: boolean;
  /** The reader may hold the title for good. */
  mayKeep: boolean;
  /** The reader may let go of that hold. */
  mayStopKeeping: boolean;
  /** The reader may bring the removed files back. */
  mayRestore: boolean;
  /** Another request still means something: for someone else, or another version. */
  mayRequestAgain: boolean;
};

/**
 * The one thing the title page offers first. `following` and `kept` are
 * standings, not commands: they say where the reader is and open the way out.
 */
export const PRIMARY_ACTIONS = [
  "request",
  "following",
  "hold",
  "keep",
  "kept",
  "restore",
] as const;
export type PrimaryAction = (typeof PRIMARY_ACTIONS)[number];

/** Everything else the reader may do, behind the menu. */
export const MENU_ACTIONS = [
  "request",
  "hold",
  "keep",
  "stop_keeping",
  "stop_following",
] as const;
export type MenuAction = (typeof MENU_ACTIONS)[number];

type TitleActions = {
  primary: PrimaryAction;
  menu: readonly MenuAction[];
};

/**
 * The first thing to offer, most urgent first:
 *
 * 1. files that are gone but can still come back;
 * 2. a removal the reader can stop;
 * 3. where the reader already stands (following, or keeping for good);
 * 4. for the owner, keeping a title the household can already watch;
 * 5. otherwise, asking for it.
 */
function primaryAction(facts: TitleFacts): PrimaryAction {
  if (facts.availability === "quarantined" && facts.mayRestore) {
    return "restore";
  }
  if (facts.leavingSoon && facts.mayHold) return "hold";
  if (facts.following) return "following";
  if (facts.kept) return "kept";
  return facts.role === "owner" &&
    facts.availability === "available" &&
    facts.mayKeep
    ? "keep"
    : "request";
}

const OFFERED: Record<MenuAction, (facts: TitleFacts) => boolean> = {
  request: (facts) => !facts.following || facts.mayRequestAgain,
  hold: (facts) => facts.mayHold && !facts.kept,
  keep: (facts) => facts.mayKeep && !facts.kept,
  stop_keeping: (facts) => facts.kept && facts.mayStopKeeping,
  stop_following: (facts) => facts.following && facts.canStopFollowing,
};

/**
 * The primary action for a title in this state, and the rest in the order
 * the menu lists them. The primary action is never repeated in the menu.
 */
export function titleActions(facts: TitleFacts): TitleActions {
  const primary = primaryAction(facts);
  return {
    primary,
    menu: MENU_ACTIONS.filter(
      (action) => action !== primary && OFFERED[action](facts),
    ),
  };
}
