import { describe, expect, it } from "vitest";
import {
  AvailabilitySchema,
  UserRoleSchema,
  type Availability,
} from "#shared/contract.ts";
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
  canStopFollowing: false,
  leavingSoon: false,
  kept: false,
  mayHold: false,
  mayKeep: false,
  mayStopKeeping: false,
  mayRestore: false,
  mayRequestAgain: false,
};

/** What the server lets an owner do with any title in the library. */
const OWNER: Partial<TitleFacts> = {
  role: "owner",
  mayHold: true,
  mayKeep: true,
  mayRequestAgain: true,
};

function primary(facts: Partial<TitleFacts>): PrimaryAction {
  return titleActions({ ...NOTHING, ...facts }).primary;
}

/**
 * For every availability: what a member who does not follow the title is
 * offered, what a member who follows it is offered, and what the owner is
 * offered when they do not follow it.
 */
const BY_AVAILABILITY = {
  wanted: { stranger: "request", follower: "following", owner: "request" },
  searching: { stranger: "request", follower: "following", owner: "request" },
  downloading: { stranger: "request", follower: "following", owner: "request" },
  validating: { stranger: "request", follower: "following", owner: "request" },
  importing: { stranger: "request", follower: "following", owner: "request" },
  // Only a title the household can already watch is worth keeping for good.
  available: { stranger: "request", follower: "following", owner: "keep" },
  // Whoever asked for a removed title, and the owner, can bring it back.
  quarantined: { stranger: "request", follower: "restore", owner: "restore" },
  removed: { stranger: "request", follower: "following", owner: "request" },
} as const satisfies Record<
  Availability,
  Record<"stranger" | "follower" | "owner", PrimaryAction>
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
        canStopFollowing: true,
        mayHold: true,
        mayRestore: gone,
      }),
    ).toBe(expected.follower);
    expect(primary({ ...OWNER, availability, mayRestore: gone })).toBe(
      expected.owner,
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
    expect(primary({ ...leaving, ...OWNER, kept: true })).toBe("hold");
    // Without the permission it is not offered at all.
    expect(primary({ ...leaving, mayHold: false })).toBe("request");
  });

  it("the owner who keeps a title for good is told so, and how to stop", () => {
    const kept = {
      ...NOTHING,
      ...OWNER,
      availability: "available",
      kept: true,
      mayStopKeeping: true,
    } as const;
    expect(titleActions(kept)).toEqual({
      primary: "kept",
      // Nothing to hold for 30 days: it is already kept for good.
      menu: ["request", "stop_keeping"],
    });
    // Following says more about the reader than keeping does.
    expect(
      titleActions({ ...kept, following: true, canStopFollowing: true }),
    ).toEqual({
      primary: "following",
      menu: ["request", "stop_keeping", "stop_following"],
    });
  });

  it("following a title offers the way to stop, and nothing it may not do", () => {
    expect(
      titleActions({
        ...NOTHING,
        availability: "downloading",
        following: true,
        canStopFollowing: true,
        mayHold: true,
      }),
    ).toEqual({ primary: "following", menu: ["hold", "stop_following"] });
    // A request that cannot be withdrawn leaves nothing behind the button.
    expect(
      titleActions({
        ...NOTHING,
        availability: "available",
        following: true,
      }),
    ).toEqual({ primary: "following", menu: [] });
  });

  it("a film can always be asked for again, in another version", () => {
    expect(
      titleActions({
        ...NOTHING,
        availability: "available",
        following: true,
        canStopFollowing: true,
        mayRequestAgain: true,
      }).menu,
    ).toEqual(["request", "stop_following"]);
  });
});

/** Every combination of the facts a read can report. */
function everyState(): TitleFacts[] {
  const flags = [
    "following",
    "canStopFollowing",
    "leavingSoon",
    "kept",
    "mayHold",
    "mayKeep",
    "mayStopKeeping",
    "mayRestore",
    "mayRequestAgain",
  ] as const;
  const states: TitleFacts[] = [];
  for (const availability of [null, ...AvailabilitySchema.options]) {
    for (const role of UserRoleSchema.options) {
      for (let bits = 0; bits < 2 ** flags.length; bits += 1) {
        const state: TitleFacts = { ...NOTHING, availability, role };
        for (const [index, flag] of flags.entries()) {
          state[flag] = Math.floor(bits / 2 ** index) % 2 === 1;
        }
        states.push(state);
      }
    }
  }
  return states;
}

describe("every state a title can be in", () => {
  const states = everyState();

  it("has one primary action and never repeats it in the menu", () => {
    expect(states).toHaveLength(9 * 2 * 512);
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
      if (!facts.mayHold) expect(offered).not.toContain("hold");
      if (!facts.mayKeep) expect(offered).not.toContain("keep");
      if (!facts.mayRestore || facts.availability !== "quarantined") {
        expect(offered).not.toContain("restore");
      }
      if (!facts.kept || !facts.mayStopKeeping) {
        expect(offered).not.toContain("stop_keeping");
      }
      if (!facts.following || !facts.canStopFollowing) {
        expect(offered).not.toContain("stop_following");
      }
      if (!facts.following) expect(first).not.toBe("following");
      if (!facts.kept) expect(first).not.toBe("kept");
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
