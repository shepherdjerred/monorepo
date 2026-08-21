import { describe, expect, test } from "vitest";
import { canConfigureKarma } from "./authorization.ts";

describe("canConfigureKarma", () => {
  test("allows the configured bot admin without Manage Server", () => {
    expect(
      canConfigureKarma({
        userId: "admin",
        adminUserId: "admin",
        hasManageGuild: false,
      }),
    ).toBe(true);
  });

  test("allows guild managers", () => {
    expect(
      canConfigureKarma({
        userId: "manager",
        adminUserId: "admin",
        hasManageGuild: true,
      }),
    ).toBe(true);
  });

  test("rejects other users without Manage Server", () => {
    expect(
      canConfigureKarma({
        userId: "member",
        adminUserId: "admin",
        hasManageGuild: false,
      }),
    ).toBe(false);
  });
});
