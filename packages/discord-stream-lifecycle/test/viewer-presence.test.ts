import { describe, expect, it } from "bun:test";
import {
  countRealViewers,
  isRealViewer,
  type ViewerCandidate,
} from "@shepherdjerred/discord-stream-lifecycle/viewer-presence.ts";

const SELF = "self-userbot-id";
const PEER_A = "peer-a-id";
const PEER_B = "peer-b-id";

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

  it("excludes peer userbots by id", () => {
    expect(
      isRealViewer(candidate({ id: PEER_A }), {
        selfUserId: SELF,
        peerUserbotIds: [PEER_A, PEER_B],
      }),
    ).toBe(false);
  });

  it("excludes go-live userbot fingerprint (streaming + selfDeaf + selfMute)", () => {
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

  it("keeps the go-live fingerprint when excludeLikelyUserbots is false", () => {
    expect(
      isRealViewer(
        candidate({
          id: "unknown-userbot",
          streaming: true,
          selfDeaf: true,
          selfMute: true,
        }),
        { selfUserId: SELF, excludeLikelyUserbots: false },
      ),
    ).toBe(true);
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

  it("catches an unknown peer userbot via the go-live fingerprint", () => {
    const members: ViewerCandidate[] = [
      candidate({
        id: SELF,
        streaming: true,
        selfDeaf: true,
        selfMute: true,
      }),
      candidate({
        id: "unconfigured-userbot",
        streaming: true,
        selfDeaf: true,
        selfMute: true,
      }),
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
