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
  /** That request can be cancelled. */
  canCancel: boolean;
  /** A removal the household can still stop is under way. */
  leavingSoon: boolean;
  /** The reader has pinned the title, so nothing removes it. */
  pinned: boolean;
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
 * The one thing the title page offers first. `following` is a standing, not
 * a command: it says where the reader is and opens the menu.
 */
export const PRIMARY_ACTIONS = [
  "request",
  "following",
  "hold",
  "restore",
] as const;
export type PrimaryAction = (typeof PRIMARY_ACTIONS)[number];

/** Everything else the reader may do, behind the menu. */
export const MENU_ACTIONS = [
  "request",
  "hold",
  "pin",
  "unpin",
  "cancel_request",
] as const;
export type MenuAction = (typeof MENU_ACTIONS)[number];

type TitleActions = {
  primary: PrimaryAction;
  menu: readonly MenuAction[];
};

/** A pinned title cannot leave, so there is nothing for a hold to stop. */
function holdOffered(facts: TitleFacts): boolean {
  return facts.mayHold && !facts.pinned;
}

/**
 * The first thing to offer, most urgent first:
 *
 * 1. files that are gone but can still come back;
 * 2. a removal the reader can stop;
 * 3. where the reader already stands: following;
 * 4. for the owner, holding a title the household can already watch;
 * 5. otherwise, asking for it.
 *
 * Keeping a title for good is the library's keeping policy, which the title
 * reads do not carry, so it is not offered here. The owner's pin is a
 * different thing and stays in the menu under its own name.
 */
function primaryAction(facts: TitleFacts): PrimaryAction {
  if (facts.availability === "quarantined" && facts.mayRestore) {
    return "restore";
  }
  if (facts.leavingSoon && holdOffered(facts)) return "hold";
  if (facts.following) return "following";
  return facts.role === "owner" &&
    facts.availability === "available" &&
    holdOffered(facts)
    ? "hold"
    : "request";
}

const OFFERED: Record<MenuAction, (facts: TitleFacts) => boolean> = {
  request: (facts) => !facts.following || facts.mayRequestAgain,
  hold: holdOffered,
  pin: (facts) => facts.mayPin && !facts.pinned,
  unpin: (facts) => facts.pinned && facts.mayUnpin,
  cancel_request: (facts) => facts.following && facts.canCancel,
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
