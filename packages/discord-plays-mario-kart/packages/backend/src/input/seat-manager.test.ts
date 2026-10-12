import { describe, expect, test } from "vitest";
import type { DiscordUser } from "@shepherdjerred/discord-plays-core/auth/protocol.ts";
import { SeatManager } from "./seat-manager.ts";

function user(discordId: string): DiscordUser {
  return {
    discordId,
    username: `u${discordId}`,
    name: `U${discordId}`,
    avatarUrl: null,
  };
}

describe("SeatManager", () => {
  test("claims the requested seat, or the lowest free one", () => {
    const seats = new SeatManager(4);
    expect(seats.claim("s1", user("1"), 2)).toMatchObject({
      kind: "claimed",
      seat: 2,
    });
    expect(seats.claim("s2", user("2"))).toMatchObject({
      kind: "claimed",
      seat: 0,
    });
    expect(seats.claim("s3", user("3"), 2)).toEqual({ kind: "taken" });
    expect(seats.users().map((u) => u?.discordId ?? null)).toEqual([
      "2",
      null,
      "1",
      null,
    ]);
  });

  test("gives one account one seat: a second tab takes it over", () => {
    const seats = new SeatManager(4);
    seats.claim("tab1", user("1"), 1);
    expect(seats.claim("tab2", user("1"))).toEqual({
      kind: "claimed",
      seat: 1,
      displacedSocketId: "tab1",
      vacatedSeat: undefined,
    });
    expect(seats.seatOf("tab1")).toBeNull();
    expect(seats.owns("tab2", 1)).toBe(true);
  });

  test("moves an account to a different seat it asks for", () => {
    const seats = new SeatManager(4);
    seats.claim("tab1", user("1"), 1);
    expect(seats.claim("tab2", user("1"), 3)).toMatchObject({
      seat: 3,
      displacedSocketId: "tab1",
      vacatedSeat: 1,
    });
    expect(seats.users()[1]).toBeNull();
  });

  test("releases by connection or by account", () => {
    const seats = new SeatManager(2);
    seats.claim("s1", user("1"));
    seats.claim("s2", user("2"));
    expect(seats.release("s1")).toBe(0);
    expect(seats.releaseUser("2")).toEqual({ seat: 1, socketId: "s2" });
    expect(seats.releaseUser("2")).toBeNull();
    expect(seats.seatedUserIds()).toEqual([]);
  });
});
