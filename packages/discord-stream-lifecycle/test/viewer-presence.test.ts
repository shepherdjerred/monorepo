import { describe, expect, it } from "bun:test";
import {
  countRealViewers,
  isRealViewer,
  KNOWN_USERBOT_IDS,
  type ViewerCandidate,
} from "@shepherdjerred/discord-stream-lifecycle/viewer-presence.ts";

const SELF = "self-userbot-id";
const PEER_A = "peer-a-id";
const PEER_B = "peer-b-id";
// A real in-tree userbot ID, used to verify KNOWN_USERBOT_IDS exclusion.
const POKEBOT_ID = KNOWN_USERBOT_IDS[0]!;

function candidate(overrides: Partial<ViewerCandidate>): ViewerCandidate {
  return {
    id: "human-1",
    isBot: false,
    streaming: false,
    selfDeaf: false,
    selfMute: false,
    ...overrides,
  };
}

describe("isRealViewer", () => {
  it("excludes self", () => {
    expect(isRealViewer(candidate({ id: SELF }), { selfUserId: SELF })).toBe(
      false,
    );
  });

  it("excludes real bot applications by default", () => {
    expect(
      isRealViewer(candidate({ id: "bot-1", isBot: true }), {
        selfUserId: SELF,
      }),
    ).toBe(false);
  });

  it("counts real bots when excludeBots is false", () => {
    expect(
      isRealViewer(candidate({ id: "bot-1", isBot: true }), {
        selfUserId: SELF,
        excludeBots: false,
      }),
    ).toBe(true);
  });

  it("excludes peer userbots by explicit peerUserbotIds", () => {
    expect(
      isRealViewer(candidate({ id: PEER_A }), {
        selfUserId: SELF,
        peerUserbotIds: [PEER_A, PEER_B],
      }),
    ).toBe(false);
  });

  it("excludes in-tree userbots via KNOWN_USERBOT_IDS", () => {
    // KNOWN_USERBOT_IDS is checked unconditionally — no config needed.
    expect(
      isRealViewer(candidate({ id: POKEBOT_ID }), { selfUserId: SELF }),
    ).toBe(false);
  });

  it("does NOT exclude a human who is just self-deafened", () => {
    expect(
      isRealViewer(candidate({ id: "afk-human", selfDeaf: true }), {
        selfUserId: SELF,
      }),
    ).toBe(true);
  });

  it("counts a human who is streaming with mic + audio", () => {
    expect(
      isRealViewer(
        candidate({
          id: "go-live-human",
          streaming: true,
          selfDeaf: false,
          selfMute: false,
        }),
        { selfUserId: SELF },
      ),
    ).toBe(true);
  });

  it("counts a plain human", () => {
    expect(isRealViewer(candidate({ id: "human" }), { selfUserId: SELF })).toBe(
      true,
    );
  });

  it("excludes go-live userbot fingerprint by default (no explicit peerUserbotIds)", () => {
    // Without an explicit peerUserbotIds list, the heuristic is active as a catch-all
    // for any 4th userbot not yet registered in KNOWN_USERBOT_IDS.
    expect(
      isRealViewer(
        candidate({
          id: "unknown-userbot",
          streaming: true,
          selfDeaf: true,
          selfMute: true,
        }),
        { selfUserId: SELF },
      ),
    ).toBe(false);
  });

  it("does NOT apply go-live heuristic when an explicit peerUserbotIds list is provided", () => {
    // When the caller supplies an explicit peer list, they have named every known peer;
    // the heuristic is suppressed so a human streaming while self-muted and self-deafened
    // is not silently excluded.
    expect(
      isRealViewer(
        candidate({
          id: "human-streaming",
          streaming: true,
          selfDeaf: true,
          selfMute: true,
        }),
        { selfUserId: SELF, peerUserbotIds: [PEER_A] },
      ),
    ).toBe(true);
  });

  it("counts normally when selfUserId is omitted", () => {
    // When no selfUserId is provided, no member is excluded via self-check.
    expect(isRealViewer(candidate({ id: "human-1" }), {})).toBe(true);
  });
});

describe("countRealViewers", () => {
  it("matches the bug scenario: self + two peer userbots + zero humans → 0", () => {
    const members: ViewerCandidate[] = [
      candidate({
        id: SELF,
        streaming: true,
        selfDeaf: true,
        selfMute: true,
      }),
      candidate({
        id: PEER_A,
        streaming: true,
        selfDeaf: true,
        selfMute: true,
      }),
      candidate({
        id: PEER_B,
        streaming: true,
        selfDeaf: true,
        selfMute: true,
      }),
    ];
    expect(
      countRealViewers(members, {
        selfUserId: SELF,
        peerUserbotIds: [PEER_A, PEER_B],
      }),
    ).toBe(0);
  });

  it("excludes in-tree userbot peers via KNOWN_USERBOT_IDS without any config", () => {
    // When the two peers are real in-tree userbots, KNOWN_USERBOT_IDS catches them
    // automatically — no peerUserbotIds config needed.
    const members: ViewerCandidate[] = [
      candidate({ id: SELF }),
      ...KNOWN_USERBOT_IDS.filter((id) => id !== SELF).map((id) =>
        candidate({ id }),
      ),
    ];
    expect(countRealViewers(members, { selfUserId: SELF })).toBe(0);
  });

  it("counts only the human when humans + bots + peers share a channel", () => {
    const members: ViewerCandidate[] = [
      candidate({ id: SELF }),
      candidate({ id: PEER_A }),
      candidate({ id: "bot-1", isBot: true }),
      candidate({ id: "human-1" }),
    ];
    expect(
      countRealViewers(members, {
        selfUserId: SELF,
        peerUserbotIds: [PEER_A],
      }),
    ).toBe(1);
  });
});
