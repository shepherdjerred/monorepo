/**
 * Authorization for the AI report-editor stream endpoint
 * (`POST /api/reports/query-agent/stream`). It must gate on `reports:create`
 * (the report-draft capability) via the shared RBAC resolver, NOT
 * `assertGuildAdmin` — otherwise a delegated Manager the UI told could use the
 * editor always gets 403.
 *
 * `ai_reports_enabled` defaults to false, so a caller that PASSES authorization
 * deterministically falls through to the "not enabled" 403 (no LLM call). That
 * makes the auth decision observable by the error message: a denied caller is
 * rejected with the missing `reports:create`, an authorized one with the
 * feature-disabled message.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  permissionKey,
} from "@scout-for-lol/data";
import { createOfflineTrpcHarness } from "#src/testing/test-trpc-caller.ts";
import configuration from "#src/configuration.ts";

const trpc = await createOfflineTrpcHarness("report-ai-http-e2e");
const { handleReportAiRoute } = await import("#src/reports/ai/http-route.ts");
const { signSession } = await import("#src/trpc/jwt.ts");

const guildId = DiscordGuildIdSchema.parse("100000000000009301");
const member = DiscordAccountIdSchema.parse("900000000000009301");
const cors: Record<string, string> = {};
let cookie = "";

const ErrBody = z.object({ error: z.string() });

async function post(): Promise<Response | null> {
  const url = new URL("http://localhost/api/reports/query-agent/stream");
  return handleReportAiRoute(
    new Request(url.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": "csrf",
        ...(configuration.webAppOrigin === undefined
          ? {}
          : { origin: configuration.webAppOrigin }),
        cookie,
      },
      body: JSON.stringify({ guildId, instructions: "make a win-rate report" }),
    }),
    url,
    cors,
  );
}

async function seedGrants(...keys: string[]): Promise<void> {
  await trpc.prisma.serverPermission.deleteMany({});
  if (keys.length === 0) return;
  await trpc.prisma.serverPermission.createMany({
    data: keys.map((permission) => ({
      serverId: guildId,
      discordUserId: member,
      permission,
      grantedBy: member,
      grantedAt: new Date(),
    })),
  });
}

beforeAll(async () => {
  await trpc.prisma.user.create({
    data: {
      discordId: member,
      discordUsername: "ai-e2e",
      discordAvatar: null,
      discordAccessToken: null,
      discordRefreshToken: null,
      tokenExpiresAt: null,
    },
  });
  const { jwt } = await signSession({ discordId: member });
  cookie = `scout_session=${jwt}; scout_csrf=csrf`;
});

afterAll(async () => {
  await trpc.prisma.$disconnect();
});

describe("report AI stream endpoint authorization", () => {
  test("member without reports:create is denied on the missing permission", async () => {
    trpc.setMembership([{ guildId, asAdmin: false }]);
    await seedGrants();
    const res = await post();
    expect(res?.status).toBe(403);
    const body = ErrBody.parse(await res?.json());
    expect(body.error).toContain("reports:create");
  });

  test("reports:read alone is insufficient", async () => {
    trpc.setMembership([{ guildId, asAdmin: false }]);
    await seedGrants(permissionKey({ resource: "reports", action: "read" }));
    const res = await post();
    expect(res?.status).toBe(403);
    const body = ErrBody.parse(await res?.json());
    expect(body.error).toContain("reports:create");
  });

  test("member with reports:create passes authorization (falls through to feature-disabled, not a permission error)", async () => {
    trpc.setMembership([{ guildId, asAdmin: false }]);
    await seedGrants(permissionKey({ resource: "reports", action: "create" }));
    const res = await post();
    // ai_reports_enabled defaults false, so passing auth yields the disabled
    // 403 — crucially NOT the reports:create permission error.
    const body = ErrBody.parse(await res?.json());
    expect(body.error).not.toContain("reports:create");
    expect(body.error.toLowerCase()).toContain("not enabled");
  });

  test("Discord admin (root) passes authorization without a grant", async () => {
    trpc.setMembership("root");
    await seedGrants();
    const res = await post();
    const body = ErrBody.parse(await res?.json());
    expect(body.error).not.toContain("reports:create");
  });
});
