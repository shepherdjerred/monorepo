import { expect, test } from "vitest";
import type { MediaActor } from "#application/auth.ts";
import { requestKeepingPolicy } from "./policy.ts";

const member: MediaActor = {
  id: "member",
  plexAccountId: "plex-member",
  displayName: "Member",
  role: "member",
  restricted: false,
  version: 0,
};
const kept = {
  active: true,
  interestState: "following",
  keepingPolicy: "keep" as const,
};

test("a repeated member request preserves an owner-granted permanent Keep", () => {
  expect(requestKeepingPolicy(member, undefined, kept)).toBe("keep");
  expect(requestKeepingPolicy(member, "temporary", kept)).toBe("keep");
});

test("a member cannot manufacture a new Keep from a cancelled historical claim", () => {
  expect(
    requestKeepingPolicy(member, undefined, { ...kept, active: false }),
  ).toBe("temporary");
  expect(() => requestKeepingPolicy(member, "keep")).toThrow("Only the owner");
});

test("a restricted account cannot grant Keep even if its stored role says owner", () => {
  const restricted = { ...member, role: "owner" as const, restricted: true };
  expect(() => requestKeepingPolicy(restricted, "keep")).toThrow(
    "Only the owner",
  );
  expect(requestKeepingPolicy(restricted, undefined)).toBe("temporary");
  expect(requestKeepingPolicy(restricted, "temporary", kept)).toBe("keep");
});

test("an owner chooses new policy explicitly and can intentionally release a prior Keep", () => {
  const owner = { ...member, role: "owner" as const };
  expect(() => requestKeepingPolicy(owner, undefined)).toThrow(
    "Choose Keep indefinitely or Temporary",
  );
  expect(requestKeepingPolicy(owner, undefined, kept)).toBe("keep");
  expect(requestKeepingPolicy(owner, "temporary", kept)).toBe("temporary");
});
