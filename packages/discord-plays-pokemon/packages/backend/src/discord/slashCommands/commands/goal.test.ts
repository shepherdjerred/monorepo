import { describe, expect, test } from "bun:test";
import { isGoalRequesterAuthorized } from "./goal.ts";

describe("isGoalRequesterAuthorized", () => {
  test("allows the user who started the session", () => {
    expect(
      isGoalRequesterAuthorized({
        requesterId: "starter",
        sessionStarterId: "starter",
      }),
    ).toBe(true);
  });

  test("rejects every other user", () => {
    expect(
      isGoalRequesterAuthorized({
        requesterId: "other-user",
        sessionStarterId: "starter",
      }),
    ).toBe(false);
  });
});
