/**
 * Customs voice moves refuse on a role that cannot see voice state.
 *
 * `moveMember` decides whom to move by reading `member.voice.channelId`, and
 * that field is populated only by gateway VOICE_STATE_UPDATE events. A REST
 * guild-member payload carries roles and a nickname and no voice channel at
 * all, so on a gatewayless role it is null for everyone: the loop would move
 * nobody, create or delete the team channels anyway, and report the arrangement
 * ready. Discord exposes no REST read for "which voice channel is this member
 * in", so there is nothing to route around it with — the only honest behaviour
 * is to refuse.
 */

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import configuration, {
  resetConfigurationForTests,
} from "#src/configuration.ts";
import {
  SCOUT_RUNTIME_ROLES,
  scoutRuntimeCapabilities,
  type ScoutRuntimeRole,
} from "#src/configuration/runtime-role.ts";
import { CustomAuthHttpError } from "#src/customs/activity/activity-auth.ts";
import {
  arrangeCustomVoice,
  cleanExpiredCustomVoice,
  returnCustomVoiceToLobby,
} from "#src/customs/voice-service.ts";

const originalRole = Bun.env["SCOUT_RUNTIME_ROLE"];

function runAs(role: ScoutRuntimeRole): void {
  Bun.env["SCOUT_RUNTIME_ROLE"] = role;
  resetConfigurationForTests();
}

beforeEach(() => {
  resetConfigurationForTests();
});

afterEach(() => {
  if (originalRole === undefined) {
    Reflect.deleteProperty(Bun.env, "SCOUT_RUNTIME_ROLE");
  } else {
    Bun.env["SCOUT_RUNTIME_ROLE"] = originalRole;
  }
  resetConfigurationForTests();
});

/**
 * Claims and input are deliberately junk: the guard runs before any of it is
 * read, which is the point — a refusal must land before a VOICE_PROVISIONING
 * mutation is committed, not part-way through the arrangement.
 */
const claims = {
  sub: "900000000000000001",
  guildId: "900000000000000002",
  channelId: "900000000000000003",
  instanceId: "instance",
  applicationId: "900000000000000004",
  type: "customs_activity",
} as const;
const input = { nightId: "night", expectedRevision: 1 };

/** Run `operation` and hand back whatever it threw. */
async function thrownBy(operation: () => Promise<unknown>): Promise<unknown> {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  throw new Error("expected the operation to be refused");
}

const GATEWAYLESS: ScoutRuntimeRole[] = ["application", "activity-worker"];
const WITH_GATEWAY: ScoutRuntimeRole[] = ["combined", "gateway"];

describe("voice-state capability", () => {
  test("is declared exactly where the gateway is", () => {
    for (const role of SCOUT_RUNTIME_ROLES) {
      const capabilities = scoutRuntimeCapabilities(role);
      expect(capabilities.voiceStateAccess).toBe(capabilities.discordGateway);
    }
  });

  test("the running process reports its own role's capability", () => {
    runAs("application");
    expect(configuration.runtimeCapabilities.voiceStateAccess).toBe(false);
    runAs("gateway");
    expect(configuration.runtimeCapabilities.voiceStateAccess).toBe(true);
  });
});

describe.each(GATEWAYLESS)("on the %s role", (role) => {
  test("arranging team voice refuses with a 503", async () => {
    runAs(role);
    await expect(arrangeCustomVoice(claims, input)).rejects.toBeInstanceOf(
      CustomAuthHttpError,
    );
  });

  test("the refusal names the gateway role", async () => {
    runAs(role);
    await expect(arrangeCustomVoice(claims, input)).rejects.toThrow(
      /gateway role/,
    );
  });

  test("returning players to the lobby refuses", async () => {
    runAs(role);
    await expect(
      returnCustomVoiceToLobby(claims, input),
    ).rejects.toBeInstanceOf(CustomAuthHttpError);
  });

  test("the expiry sweep refuses rather than deleting occupied channels", async () => {
    // This one runs as a background Temporal Activity with no operator
    // watching. Refusing surfaces as a failed Activity; the silent path would
    // have deleted the team channels out from under the players in them.
    runAs(role);
    await expect(cleanExpiredCustomVoice("night")).rejects.toBeInstanceOf(
      CustomAuthHttpError,
    );
  });

  test("the refusal is a 503, not an authorization failure", async () => {
    runAs(role);
    const error = await thrownBy(() => arrangeCustomVoice(claims, input));
    expect(error).toBeInstanceOf(CustomAuthHttpError);
    // 503, because the operator is permitted to do this and Scout is the thing
    // that is unable — reporting 403 would tell them to fix their permissions.
    expect(error).toHaveProperty("status", 503);
  });
});

describe.each(WITH_GATEWAY)("on the %s role", (role) => {
  test("voice arrangement is not refused by the capability guard", async () => {
    runAs(role);
    // It still fails — the junk claims do not authorize anything — but it gets
    // past the capability guard to the ordinary auth check, which is what
    // proves the guard is role-scoped rather than always-on.
    const error = await thrownBy(() => arrangeCustomVoice(claims, input));
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toMatch(/gateway role/);
  });
});
