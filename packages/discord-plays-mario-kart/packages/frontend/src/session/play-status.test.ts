import { describe, expect, it } from "vitest";
import { describePlayStatus, describeSeatDenied } from "./play-status.ts";

const base = {
  connected: true,
  blocker: null,
  voiceChannelName: "Racing",
  seat: null,
} as const;

describe("describePlayStatus", () => {
  it("asks a signed-out viewer to sign in", () => {
    const status = describePlayStatus({ ...base, blocker: "signed-out" });
    expect(status.title).toBe("Sign in with Discord to play");
    expect(status.tone).toBe("blocked");
  });

  it("names the voice channel to join", () => {
    expect(describePlayStatus({ ...base, blocker: "not-in-voice" }).title).toBe(
      "Join Racing in Discord to play",
    );
    expect(
      describePlayStatus({
        ...base,
        blocker: "not-in-voice",
        voiceChannelName: null,
      }).title,
    ).toBe("Join the game's voice channel in Discord to play");
  });

  it("explains how to start a game when none is running", () => {
    const status = describePlayStatus({ ...base, blocker: "no-session" });
    expect(status.title).toBe("No game running");
    expect(status.detail).toContain("/play");
  });

  it("invites a cleared viewer to pick a seat", () => {
    expect(describePlayStatus(base).title).toBe("Pick a seat to start driving");
  });

  it("reports the seat being driven, ahead of any blocker", () => {
    const status = describePlayStatus({
      ...base,
      seat: 1,
      blocker: "not-in-voice",
    });
    expect(status.title).toBe("You're driving as P2");
    expect(status.tone).toBe("driving");
  });

  it("reports a dropped connection first", () => {
    expect(
      describePlayStatus({ ...base, connected: false, seat: 0 }).tone,
    ).toBe("offline");
  });

  it("shows loading before the first status arrives", () => {
    expect(describePlayStatus({ ...base, blocker: undefined }).title).toBe(
      "Loading game status…",
    );
  });
});

describe("describeSeatDenied", () => {
  it("has a message for every reason", () => {
    expect(describeSeatDenied("taken", "Racing")).toBe(
      "Someone grabbed that seat first.",
    );
    expect(describeSeatDenied("not-in-voice", "Racing")).toBe(
      "Join Racing in Discord first.",
    );
    expect(describeSeatDenied("signed-out", null)).toContain("Sign in");
    expect(describeSeatDenied("no-session", null)).toContain("/play");
  });
});
