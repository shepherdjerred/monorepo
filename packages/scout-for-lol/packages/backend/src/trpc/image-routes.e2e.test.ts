/**
 * Image-route authorization. The PNG `<img src>` GET routes must honor the same
 * per-guild RBAC read permission as the corresponding tRPC read
 * (`competitions:read` for leaderboards, `reports:read` for report runs), NOT
 * `assertGuildAdmin` — otherwise a delegated Viewer/Manager gets 403 for a chart
 * their tRPC read already returned. Exercised over the real `handleImageRoute`
 * boundary with a signed `scout_session` cookie.
 *
 * The S3 loaders are stubbed to `null` so the test is deterministic and about
 * authorization only: an authorized-but-imageless request is 404, a denied one
 * is 403 — the two are unambiguous.
 */

import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  permissionKey,
} from "@scout-for-lol/data";
import { createOfflineTrpcHarness } from "#src/testing/test-trpc-caller.ts";
import * as leaderboardImageModule from "#src/storage/s3-leaderboard-image.ts";
import * as reportRunModule from "#src/storage/s3-report-run.ts";

// Install harness mocks (prisma + Discord seams) first, then stub the S3 loaders
// before importing the route so it binds to the stubs.
const trpc = await createOfflineTrpcHarness("image-routes-e2e");

void mock.module("#src/storage/s3-leaderboard-image.ts", () => ({
  ...leaderboardImageModule,
  loadLeaderboardImage: () => Promise.resolve(null),
}));
void mock.module("#src/storage/s3-report-run.ts", () => ({
  ...reportRunModule,
  loadReportRunImage: () => Promise.resolve(null),
}));

const { handleImageRoute } = await import("#src/trpc/image-routes.ts");
const { signSession } = await import("#src/trpc/jwt.ts");

const guildId = DiscordGuildIdSchema.parse("100000000000009201");
const member = DiscordAccountIdSchema.parse("900000000000009201");
const channelId = DiscordChannelIdSchema.parse("800000000000009201");

const cors: Record<string, string> = {};
let cookie = "";
let competitionId = 0;
let reportId = 0;
let runId = 0;

async function get(path: string): Promise<Response | null> {
  const url = new URL(`http://localhost${path}`);
  return handleImageRoute(
    new Request(url.toString(), { headers: cookie ? { cookie } : {} }),
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
  const now = new Date();
  await trpc.prisma.user.create({
    data: {
      discordId: member,
      discordUsername: "img-e2e",
      discordAvatar: null,
      discordAccessToken: null,
      discordRefreshToken: null,
      tokenExpiresAt: null,
    },
  });
  const competition = await trpc.prisma.competition.create({
    data: {
      serverId: guildId,
      ownerId: member,
      title: "t",
      description: "d",
      channelId,
      visibility: "OPEN",
      criteriaType: "PLACEMENT",
      criteriaConfig: "{}",
      creatorDiscordId: member,
      createdTime: now,
      updatedTime: now,
    },
  });
  competitionId = competition.id;
  const report = await trpc.prisma.report.create({
    data: {
      serverId: guildId,
      ownerId: member,
      channelId,
      title: "r",
      queryText: "q",
      cronExpression: "0 0 * * *",
      createdTime: now,
      updatedTime: now,
    },
  });
  reportId = report.id;
  const run = await trpc.prisma.reportRun.create({
    data: {
      reportId: report.id,
      serverId: guildId,
      trigger: "MANUAL",
      status: "SUCCESS",
      startedAt: now,
    },
  });
  runId = run.id;
  const { jwt } = await signSession({ discordId: member });
  cookie = `scout_session=${jwt}`;
});

afterAll(async () => {
  await trpc.prisma.$disconnect();
});

describe("image-route RBAC authorization", () => {
  test("member without a grant is denied (403) for both charts", async () => {
    trpc.setMembership([{ guildId, asAdmin: false }]);
    await seedGrants();

    const lb = await get(
      `/api/competition/${String(competitionId)}/leaderboard.png`,
    );
    expect(lb?.status).toBe(403);
    const rr = await get(
      `/api/report/${String(reportId)}/runs/${String(runId)}.png`,
    );
    expect(rr?.status).toBe(403);
  });

  test("member with the read grant passes authorization (404, image absent)", async () => {
    trpc.setMembership([{ guildId, asAdmin: false }]);
    await seedGrants(
      permissionKey({ resource: "competitions", action: "read" }),
      permissionKey({ resource: "reports", action: "read" }),
    );

    const lb = await get(
      `/api/competition/${String(competitionId)}/leaderboard.png`,
    );
    expect(lb?.status).toBe(404);
    const rr = await get(
      `/api/report/${String(reportId)}/runs/${String(runId)}.png`,
    );
    expect(rr?.status).toBe(404);
  });

  test("a reports:read holder is still denied the leaderboard (wrong resource)", async () => {
    trpc.setMembership([{ guildId, asAdmin: false }]);
    await seedGrants(permissionKey({ resource: "reports", action: "read" }));

    const lb = await get(
      `/api/competition/${String(competitionId)}/leaderboard.png`,
    );
    expect(lb?.status).toBe(403);
  });

  test("Discord admin (root) is allowed without any grant", async () => {
    trpc.setMembership("root");
    await seedGrants();

    const lb = await get(
      `/api/competition/${String(competitionId)}/leaderboard.png`,
    );
    expect(lb?.status).toBe(404);
    const rr = await get(
      `/api/report/${String(reportId)}/runs/${String(runId)}.png`,
    );
    expect(rr?.status).toBe(404);
  });

  test("no session cookie is 401", async () => {
    trpc.setMembership([{ guildId, asAdmin: false }]);
    const url = new URL(
      `http://localhost/api/competition/${String(competitionId)}/leaderboard.png`,
    );
    const res = await handleImageRoute(new Request(url.toString()), url, cors);
    expect(res?.status).toBe(401);
  });
});
