import { describe, expect, test } from "vitest";
import {
  installCompletedEventProps,
  installContinueTarget,
  installLandingCopy,
  installLandingResult,
} from "#src/lib/install-landing-state.ts";

const GUILD = "100000000000000042";

describe("installLandingResult", () => {
  test("keeps the server-echoed guild for completed installs", () => {
    expect(
      installLandingResult({
        outcome: "attributed",
        guildId: GUILD,
        surface: "guild_picker",
      }),
    ).toEqual({ outcome: "attributed", guildId: GUILD });
  });

  test("drops the guild for invalid and cancelled outcomes", () => {
    expect(installLandingResult({ outcome: "invalid" })).toEqual({
      outcome: "invalid",
      guildId: null,
    });
    expect(installLandingResult({ outcome: "cancelled" })).toEqual({
      outcome: "cancelled",
      guildId: null,
    });
  });
});

describe("installCompletedEventProps", () => {
  test.each(["attributed", "pending"] as const)(
    "fires for a %s install with server-echoed values",
    (outcome) => {
      expect(
        installCompletedEventProps({
          outcome,
          guildId: GUILD,
          surface: "onboarding_wizard",
        }),
      ).toEqual({
        guild_id: GUILD,
        outcome,
        surface: "onboarding_wizard",
      });
    },
  );

  test("does not fire for already_installed, cancelled, or invalid", () => {
    expect(
      installCompletedEventProps({
        outcome: "already_installed",
        guildId: GUILD,
        surface: "guild_picker",
      }),
    ).toBeNull();
    expect(installCompletedEventProps({ outcome: "cancelled" })).toBeNull();
    expect(installCompletedEventProps({ outcome: "invalid" })).toBeNull();
  });
});

describe("installLandingCopy", () => {
  test("confirms the install only for attributed and pending", () => {
    expect(
      installLandingCopy({ outcome: "attributed", guildId: GUILD }).title,
    ).toBe("Scout added 🎉");
    expect(
      installLandingCopy({ outcome: "pending", guildId: GUILD }).title,
    ).toBe("Scout added 🎉");
    expect(
      installLandingCopy({ outcome: "invalid", guildId: null }).title,
    ).toBe("Finish setup");
    expect(
      installLandingCopy({ outcome: "cancelled", guildId: null }).title,
    ).toBe("Finish setup");
  });

  test("names the already-installed case without claiming a new install", () => {
    const copy = installLandingCopy({
      outcome: "already_installed",
      guildId: GUILD,
    });
    expect(copy.title).toBe("Finish setup");
    expect(copy.description).toContain("already");
  });

  test("shows progress copy while the mutation is in flight", () => {
    expect(installLandingCopy(null).title).toBe("Finishing up…");
  });
});

describe("installContinueTarget", () => {
  test("deep-links the wizard into the installed guild", () => {
    expect(
      installContinueTarget({ outcome: "attributed", guildId: GUILD }),
    ).toBe(`/welcome?guild=${GUILD}`);
  });

  test("falls back to the plain wizard without a guild", () => {
    expect(installContinueTarget(null)).toBe("/welcome");
    expect(installContinueTarget({ outcome: "invalid", guildId: null })).toBe(
      "/welcome",
    );
  });
});
