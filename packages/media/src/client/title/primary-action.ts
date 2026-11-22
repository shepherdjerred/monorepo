import type { Availability, MediaUser } from "#shared/contract.ts";

/**
 * What the reader's own standing with a title allows right now. Every field
 * comes from a read: the page decides nothing the server has not said.
 */
export type TitleFacts = {
  /** Where the household's copy stands; null when the household has none. */
  availability: Availability | null;
  role: MediaUser["role"];
  /** The reader has a request for the title and still follows it. */
  following: boolean;
  /** That following is the reader's own to let go: "Stop following". */
  mayStopFollowing: boolean;
  /** The reader's request can be withdrawn: "Cancel request". */
  canCancel: boolean;
  /** A removal the household can still stop is under way. */
  leavingSoon: boolean;
  /** The reader has pinned the title, so nothing removes it. */
  pinned: boolean;
  /**
   * The library keeps the title for good: by the owner's switch, or because
   * a request asks for that. Every reader is told this much.
   */
  keptForGood: boolean;
  /**
   * Where the owner's keeping switch for the title stands. Null where this
   * page has no switch: for a member, and on a season or an episode, whose
   * keeping is its series'.
   */
  keeping: "keep" | "temporary" | null;
  /** The reader may hold the title for 30 days. */
  mayHold: boolean;
  /** The reader may pin the title. */
  mayPin: boolean;
  /** The reader may take their pin off. */
  mayUnpin: boolean;
  /** The reader may bring the removed files back. */
  mayRestore: boolean;
  /** Another request still means something: for someone else, or another version. */
  mayRequestAgain: boolean;
};

/**
 * The one thing the title page offers first. `following` and `kept_for_good`
 * are standings, not commands: each says where the title is and opens the
 * menu, which holds the way out.
 */
export const PRIMARY_ACTIONS = [
  "request",
  "following",
  "hold",
  "keep_for_good",
  "kept_for_good",
  "restore",
] as const;
export type PrimaryAction = (typeof PRIMARY_ACTIONS)[number];

/** Everything else the reader may do, behind the menu, in the menu's order. */
export const MENU_ACTIONS = [
  "request",
  "keep_for_good",
  "keep_for_now",
  "hold",
  "pin",
  "unpin",
  "stop_following",
  "cancel_request",
] as const;
export type MenuAction = (typeof MENU_ACTIONS)[number];

type TitleActions = {
  primary: PrimaryAction;
  menu: readonly MenuAction[];
};

/**
 * A hold stops a removal for a month. A pinned title cannot leave, and
 * neither can one the library keeps for good, so there a hold has nothing to
 * stop: it is offered only against a removal already under way.
 */
function holdOffered(facts: TitleFacts): boolean {
  const somethingToStop = facts.leavingSoon || !facts.keptForGood;
  return facts.mayHold && !facts.pinned && somethingToStop;
}

/**
 * What the owner is offered first on a title the household can watch: how
 * long the library keeps it. A title already kept for good says so, whether
 * the switch or a request keeps it, and the switch is then in the menu.
 */
function ownerAction(facts: TitleFacts): PrimaryAction {
  const switched =
    facts.keeping === "keep" || facts.keptForGood
      ? "kept_for_good"
      : "keep_for_good";
  // A season or an episode has no switch of its own; it can be held.
  const held = holdOffered(facts) ? "hold" : "request";
  return facts.keeping === null ? held : switched;
}

/**
 * The first thing to offer, most urgent first:
 *
 * 1. files that are gone but can still come back;
 * 2. a removal the reader can stop, with the 30-day hold anyone may use;
 * 3. where the reader already stands: following;
 * 4. for the owner, on a title the household can already watch, how long the
 *    library keeps it: the switch itself, or where it stands;
 * 5. otherwise, asking for it.
 *
 * The owner's pin never comes first. It is a different thing from the
 * keeping switch and stays in the menu under its own name.
 */
function primaryAction(facts: TitleFacts): PrimaryAction {
  if (facts.availability === "quarantined" && facts.mayRestore) {
    return "restore";
  }
  if (facts.leavingSoon && holdOffered(facts)) return "hold";
  if (facts.following) return "following";
  return facts.role === "owner" && facts.availability === "available"
    ? ownerAction(facts)
    : "request";
}

const OFFERED: Record<MenuAction, (facts: TitleFacts) => boolean> = {
  request: (facts) => !facts.following || facts.mayRequestAgain,
  keep_for_good: (facts) => facts.keeping === "temporary",
  keep_for_now: (facts) => facts.keeping === "keep",
  hold: holdOffered,
  pin: (facts) => facts.mayPin && !facts.pinned,
  unpin: (facts) => facts.pinned && facts.mayUnpin,
  stop_following: (facts) => facts.following && facts.mayStopFollowing,
  // One way out at a time: where the following can be let go, that is the
  // way, and withdrawing the request is left for where it cannot.
  cancel_request: (facts) =>
    facts.following && facts.canCancel && !facts.mayStopFollowing,
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
