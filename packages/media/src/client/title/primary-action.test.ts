import { describe, expect, it } from "vitest";
import {
  AvailabilitySchema,
  UserRoleSchema,
  type Availability,
} from "#shared/contract.ts";
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
  canCancel: false,
  leavingSoon: false,
  pinned: false,
  mayHold: false,
  mayPin: false,
  mayUnpin: false,
  mayRestore: false,
  mayRequestAgain: false,
};

/** What the server lets an owner do with any title in the library. */
const OWNER: Partial<TitleFacts> = {
  role: "owner",
  mayHold: true,
  mayPin: true,
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
  // Only a title the household can already watch is worth holding.
  available: { stranger: "request", follower: "following", owner: "hold" },
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
        canCancel: true,
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
    // Without the permission it is not offered at all.
    expect(primary({ ...leaving, mayHold: false })).toBe("request");
  });

  it("the owner's pin is a menu item under its own name, never the main action", () => {
    const owner = { ...NOTHING, ...OWNER, availability: "available" } as const;
    expect(titleActions(owner)).toEqual({
      primary: "hold",
      menu: ["request", "pin"],
    });
    // A pinned title cannot leave: nothing to hold, and the pin can come off.
    expect(titleActions({ ...owner, pinned: true, mayUnpin: true })).toEqual({
      primary: "request",
      menu: ["unpin"],
    });
    expect(
      titleActions({
        ...owner,
        pinned: true,
        mayUnpin: true,
        leavingSoon: true,
      }).primary,
    ).toBe("request");
    // A pin is never called keeping for good: that is the library's policy.
    expect(COMMAND_COPY.pin.label).toBe("Pin so it never leaves");
    expect(COMMAND_COPY.unpin.label).toBe("Remove pin");
    for (const copy of Object.values(COMMAND_COPY)) {
      expect(`${copy.label} ${copy.done}`).not.toMatch(/for good/iu);
    }
  });

  it("following a title offers cancelling the request, and nothing it may not do", () => {
    expect(
      titleActions({
        ...NOTHING,
        availability: "downloading",
        following: true,
        canCancel: true,
        mayHold: true,
      }),
    ).toEqual({ primary: "following", menu: ["hold", "cancel_request"] });
    // A request that cannot be cancelled leaves nothing behind the button.
    expect(
      titleActions({ ...NOTHING, availability: "available", following: true }),
    ).toEqual({ primary: "following", menu: [] });
    // "Stop following" names another command, which this page cannot send.
    expect(COMMAND_COPY.cancel_request.label).toBe("Cancel request");
    expect(COMMAND_COPY.cancel_request.done).toBe("Request cancelled.");
  });

  it("a film can always be asked for again, in another version", () => {
    expect(
      titleActions({
        ...NOTHING,
        availability: "available",
        following: true,
        canCancel: true,
        mayRequestAgain: true,
      }).menu,
    ).toEqual(["request", "cancel_request"]);
  });
});

/** Every combination of the facts a read can report. */
function everyState(): TitleFacts[] {
  const flags = [
    "following",
    "canCancel",
    "leavingSoon",
    "pinned",
    "mayHold",
    "mayPin",
    "mayUnpin",
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
      if (!facts.following) expect(first).not.toBe("following");
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
