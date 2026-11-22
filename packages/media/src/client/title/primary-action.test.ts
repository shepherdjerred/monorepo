import { describe, expect, it } from "vitest";
import {
  AvailabilitySchema,
  UserRoleSchema,
  type Availability,
} from "#shared/contract.ts";
import {
  INTEREST_ACTION_NAMES,
  LIBRARY_KEEPING_NAMES,
} from "#shared/household/names.ts";
import { COMMAND_COPY } from "./copy.ts";
import {
  MENU_ACTIONS,
  PRIMARY_ACTIONS,
  titleActions,
  type PrimaryAction,
  type TitleFacts,
} from "./primary-action.ts";

/** A title the reader has no standing with and may do nothing to. */
const NOTHING: TitleFacts = {
  availability: null,
  role: "member",
  following: false,
  mayStopFollowing: false,
  canCancel: false,
  leavingSoon: false,
  pinned: false,
  keptForGood: false,
  keeping: null,
  mayHold: false,
  mayPin: false,
  mayUnpin: false,
  mayRestore: false,
  mayRequestAgain: false,
};

/**
 * What the server lets an owner do with a film or series in the library that
 * is kept just for now.
 */
const OWNER: Partial<TitleFacts> = {
  role: "owner",
  keeping: "temporary",
  mayHold: true,
  mayPin: true,
  mayRequestAgain: true,
};

/** The same title once the owner's switch keeps it for good. */
const KEPT: Partial<TitleFacts> = {
  ...OWNER,
  keeping: "keep",
  keptForGood: true,
};

function primary(facts: Partial<TitleFacts>): PrimaryAction {
  return titleActions({ ...NOTHING, ...facts }).primary;
}

/**
 * For every availability: what a member who does not follow the title is
 * offered, what a member who follows it is offered, and what the owner is
 * offered when they do not follow it, with the switch on each side.
 */
const BY_AVAILABILITY = {
  wanted: {
    stranger: "request",
    follower: "following",
    owner: "request",
    kept: "request",
  },
  searching: {
    stranger: "request",
    follower: "following",
    owner: "request",
    kept: "request",
  },
  downloading: {
    stranger: "request",
    follower: "following",
    owner: "request",
    kept: "request",
  },
  validating: {
    stranger: "request",
    follower: "following",
    owner: "request",
    kept: "request",
  },
  importing: {
    stranger: "request",
    follower: "following",
    owner: "request",
    kept: "request",
  },
  // Only for a title the household can already watch does how long to keep
  // it come first.
  available: {
    stranger: "request",
    follower: "following",
    owner: "keep_for_good",
    kept: "kept_for_good",
  },
  // Whoever asked for a removed title, and the owner, can bring it back.
  quarantined: {
    stranger: "request",
    follower: "restore",
    owner: "restore",
    kept: "restore",
  },
  removed: {
    stranger: "request",
    follower: "following",
    owner: "request",
    kept: "request",
  },
} as const satisfies Record<
  Availability,
  Record<"stranger" | "follower" | "owner" | "kept", PrimaryAction>
>;

describe("the primary action of a title", () => {
  it.each(AvailabilitySchema.options)("%s", (availability) => {
    const expected = BY_AVAILABILITY[availability];
    const gone = availability === "quarantined";
    expect(primary({ availability })).toBe(expected.stranger);
    expect(
      primary({
        availability,
        following: true,
        canCancel: true,
        mayHold: true,
        mayRestore: gone,
      }),
    ).toBe(expected.follower);
    expect(primary({ ...OWNER, availability, mayRestore: gone })).toBe(
      expected.owner,
    );
    expect(primary({ ...KEPT, availability, mayRestore: gone })).toBe(
      expected.kept,
    );
  });

  it("asks for a title the household does not have, whoever is reading", () => {
    for (const role of UserRoleSchema.options) {
      expect(titleActions({ ...NOTHING, role })).toEqual({
        primary: "request",
        menu: [],
      });
    }
  });

  it("a removal the reader can stop comes before where they stand", () => {
    const leaving = {
      availability: "available",
      leavingSoon: true,
      mayHold: true,
    } as const;
    // Anyone may hold a title that is leaving soon, follower or not.
    expect(primary(leaving)).toBe("hold");
    expect(primary({ ...leaving, following: true })).toBe("hold");
    // Without the permission it is not offered at all.
    expect(primary({ ...leaving, mayHold: false })).toBe("request");
    // The owner is offered the same hold first; the switch is in the menu.
    expect(titleActions({ ...NOTHING, ...OWNER, ...leaving })).toEqual({
      primary: "hold",
      menu: ["request", "keep_for_good", "pin"],
    });
  });
});

describe("how long the library keeps a title", () => {
  const watchable = { availability: "available" } as const;

  it("the owner's switch comes first on a title the household can watch", () => {
    expect(titleActions({ ...NOTHING, ...OWNER, ...watchable })).toEqual({
      primary: "keep_for_good",
      menu: ["request", "hold", "pin"],
    });
  });

  it("a title kept for good says so, and the way back is in its menu", () => {
    // Kept for good, it cannot leave: there is nothing for a hold to stop.
    expect(titleActions({ ...NOTHING, ...KEPT, ...watchable })).toEqual({
      primary: "kept_for_good",
      menu: ["request", "keep_for_now", "pin"],
    });
  });

  it("a title a request keeps for good says so while the switch is still off", () => {
    expect(
      titleActions({
        ...NOTHING,
        ...OWNER,
        ...watchable,
        keptForGood: true,
      }),
    ).toEqual({
      primary: "kept_for_good",
      menu: ["request", "keep_for_good", "pin"],
    });
  });

  it("the switch stays within reach when something else comes first", () => {
    const following = { ...watchable, following: true } as const;
    expect(titleActions({ ...NOTHING, ...OWNER, ...following }).menu).toEqual([
      "request",
      "keep_for_good",
      "hold",
      "pin",
    ]);
    expect(titleActions({ ...NOTHING, ...KEPT, ...following }).menu).toEqual([
      "request",
      "keep_for_now",
      "pin",
    ]);
    // Not yet watchable: the owner can still decide how long it will stay.
    expect(
      titleActions({ ...NOTHING, ...OWNER, availability: "downloading" }),
    ).toEqual({ primary: "request", menu: ["keep_for_good", "hold", "pin"] });
  });

  it("a member has no switch, and neither does a season or an episode", () => {
    const member = titleActions({
      ...NOTHING,
      ...watchable,
      keptForGood: true,
      mayHold: true,
    });
    expect(member).toEqual({ primary: "request", menu: [] });
    // The owner on a season: its keeping is the series', so it can be held.
    expect(
      titleActions({ ...NOTHING, ...OWNER, ...watchable, keeping: null }),
    ).toEqual({ primary: "hold", menu: ["request", "pin"] });
  });

  it("the three ways of keeping a title have three names", () => {
    expect(COMMAND_COPY.keep_for_good.label).toBe(LIBRARY_KEEPING_NAMES.keep);
    expect(COMMAND_COPY.keep_for_now.label).toBe(
      LIBRARY_KEEPING_NAMES.temporary,
    );
    expect(COMMAND_COPY.hold.label).toBe("Keep for 30 days");
    expect(COMMAND_COPY.pin.label).toBe("Pin so it never leaves");
    expect(COMMAND_COPY.unpin.label).toBe("Remove pin");
    // Neither a hold nor a pin is ever called keeping for good.
    for (const copy of [
      COMMAND_COPY.hold,
      COMMAND_COPY.pin,
      COMMAND_COPY.unpin,
    ]) {
      expect(`${copy.label} ${copy.done}`).not.toMatch(/for good/iu);
    }
    const labels = Object.values(COMMAND_COPY).map((copy) => copy.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("the owner's pin is a menu item under its own name, never the main action", () => {
    const owner = { ...NOTHING, ...OWNER, ...watchable } as const;
    // A pinned title cannot leave: nothing to hold, and the pin can come off.
    expect(titleActions({ ...owner, pinned: true, mayUnpin: true })).toEqual({
      primary: "keep_for_good",
      menu: ["request", "unpin"],
    });
    expect(
      titleActions({
        ...owner,
        pinned: true,
        mayUnpin: true,
        leavingSoon: true,
      }).primary,
    ).toBe("keep_for_good");
  });
});

describe("leaving a title the reader follows", () => {
  const followed = {
    ...NOTHING,
    availability: "downloading",
    following: true,
    mayHold: true,
  } as const;

  it("an interest of the reader's own is let go with Stop following", () => {
    expect(
      titleActions({ ...followed, mayStopFollowing: true, canCancel: true }),
    ).toEqual({ primary: "following", menu: ["hold", "stop_following"] });
    expect(COMMAND_COPY.stop_following.label).toBe(INTEREST_ACTION_NAMES.drop);
  });

  it("where there is no such interest, the request is withdrawn instead", () => {
    // A season a series request covers, another version of a film, or a
    // request that keeps the title for good.
    expect(titleActions({ ...followed, canCancel: true })).toEqual({
      primary: "following",
      menu: ["hold", "cancel_request"],
    });
    expect(COMMAND_COPY.cancel_request.label).toBe("Cancel request");
    expect(COMMAND_COPY.cancel_request.done).toBe("Request cancelled.");
  });

  it("a request that can be neither leaves nothing behind the button", () => {
    expect(
      titleActions({ ...NOTHING, availability: "available", following: true }),
    ).toEqual({ primary: "following", menu: [] });
  });

  it("a film can always be asked for again, in another version", () => {
    expect(
      titleActions({
        ...NOTHING,
        availability: "available",
        following: true,
        mayStopFollowing: true,
        mayRequestAgain: true,
      }).menu,
    ).toEqual(["request", "stop_following"]);
  });
});

/** Every combination of the facts a read can report. */
function everyState(): TitleFacts[] {
  const flags = [
    "following",
    "mayStopFollowing",
    "canCancel",
    "leavingSoon",
    "pinned",
    "keptForGood",
    "mayHold",
    "mayPin",
    "mayUnpin",
    "mayRestore",
    "mayRequestAgain",
  ] as const;
  const standings = [null, ...AvailabilitySchema.options].flatMap(
    (availability) =>
      UserRoleSchema.options.flatMap((role) =>
        ([null, "keep", "temporary"] as const).map((keeping) => ({
          ...NOTHING,
          availability,
          role,
          keeping,
        })),
      ),
  );
  const states: TitleFacts[] = [];
  for (const standing of standings) {
    for (let bits = 0; bits < 2 ** flags.length; bits += 1) {
      const state: TitleFacts = { ...standing };
      for (const [index, flag] of flags.entries()) {
        state[flag] = Math.floor(bits / 2 ** index) % 2 === 1;
      }
      states.push(state);
    }
  }
  return states;
}

describe("every state a title can be in", () => {
  const states = everyState();

  it("has one primary action and never repeats it in the menu", () => {
    expect(states).toHaveLength(9 * 2 * 3 * 2048);
    for (const facts of states) {
      const { primary: first, menu } = titleActions(facts);
      expect(PRIMARY_ACTIONS).toContain(first);
      expect(menu).not.toContain(first);
      expect(new Set(menu).size).toBe(menu.length);
      for (const action of menu) expect(MENU_ACTIONS).toContain(action);
    }
  });

  it("never offers what the read did not allow", () => {
    for (const facts of states) {
      const { primary: first, menu } = titleActions(facts);
      const offered = [first, ...menu];
      if (!facts.mayHold || facts.pinned) expect(offered).not.toContain("hold");
      if (!facts.mayPin) expect(offered).not.toContain("pin");
      if (!facts.mayRestore || facts.availability !== "quarantined") {
        expect(offered).not.toContain("restore");
      }
      if (!facts.pinned || !facts.mayUnpin) {
        expect(offered).not.toContain("unpin");
      }
      if (!facts.following || !facts.canCancel) {
        expect(offered).not.toContain("cancel_request");
      }
      if (!facts.following || !facts.mayStopFollowing) {
        expect(offered).not.toContain("stop_following");
      }
      if (!facts.following) expect(first).not.toBe("following");
    }
  });

  it("offers the keeping switch exactly where the page has one", () => {
    for (const facts of states) {
      const { primary: first, menu } = titleActions(facts);
      const offered = [first, ...menu];
      const switches = offered.filter(
        (action) => action === "keep_for_good" || action === "keep_for_now",
      );
      // One side of the switch at a time: the side it is not on.
      expect(switches).toEqual(
        {
          keep: ["keep_for_now"],
          temporary: ["keep_for_good"],
          none: [],
        }[facts.keeping ?? "none"],
      );
      if (first === "kept_for_good") {
        expect(facts.keeping === "keep" || facts.keptForGood).toBe(true);
      }
    }
  });

  it("offers one way out of following, never two", () => {
    for (const facts of states) {
      const { menu } = titleActions(facts);
      const ways = menu.filter(
        (action) => action === "stop_following" || action === "cancel_request",
      );
      expect(ways.length).toBeLessThanOrEqual(1);
      if (facts.following && facts.canCancel) expect(ways).toHaveLength(1);
    }
  });

  it("always leaves a way to ask for a title the reader does not follow", () => {
    for (const facts of states) {
      if (facts.following) continue;
      const { primary: first, menu } = titleActions(facts);
      expect([first, ...menu]).toContain("request");
    }
  });

  it("reaches every primary action", () => {
    const reached = new Set(states.map((facts) => titleActions(facts).primary));
    expect([...reached].sort()).toEqual([...PRIMARY_ACTIONS].sort());
  });
});
