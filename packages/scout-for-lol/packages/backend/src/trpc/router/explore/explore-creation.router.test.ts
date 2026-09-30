import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import {
  ConfirmationIntentPayloadSchema,
  permissionKey,
  type ConfirmationIntentPayload,
  type DiscordAccountId,
  type DiscordGuildId,
  type Permission,
} from "@scout-for-lol/data";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import { resetConfigurationForTests } from "#src/configuration.ts";
import {
  addFlagOverride,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import { clearAllRateLimits } from "#src/database/competition/rate-limit.ts";
import { createOfflineTrpcHarness } from "#src/testing/test-trpc-caller.ts";
import {
  testAccountId,
  testChannelId,
  testGuildId,
  testPuuid,
} from "#src/testing/test-ids.ts";

/**
 * The confirm path is the security surface of Explore-driven creation: an AI
 * agent prepares the intent, so every check that decides whether the write is
 * allowed has to happen here, at confirm time, against live state.
 *
 * The harness installs module mocks, so it must run before anything imports the
 * router (see its docblock).
 */
const GUILD = testGuildId("410001");
const OTHER_GUILD = testGuildId("410002");
const CHANNEL = testChannelId("410003");
const ACTOR = testAccountId("910000001");
const STRANGER = testAccountId("910000002");

const trpc = await createOfflineTrpcHarness("explore-creation-test");
const db = trpc.prisma;

const QUERY_TEXT =
  "SELECT player, COUNT(*) AS games FROM match_participants GROUP BY player RENDER table";

function setAllowlist(value: string | undefined): void {
  if (value === undefined) {
    delete Bun.env["EXPLORE_GUILD_ALLOWLIST"];
  } else {
    Bun.env["EXPLORE_GUILD_ALLOWLIST"] = value;
  }
  resetConfigurationForTests();
}

function reportPayload(
  guildId: DiscordGuildId = GUILD,
): ConfirmationIntentPayload {
  return ConfirmationIntentPayloadSchema.parse({
    kind: "report",
    guildId,
    channelId: CHANNEL,
    title: "Weekly games",
    description: null,
    queryText: QUERY_TEXT,
  });
}

function subscriptionPayload(
  account = "explore-creation",
): ConfirmationIntentPayload {
  return ConfirmationIntentPayloadSchema.parse({
    kind: "subscription",
    guildId: GUILD,
    channelId: CHANNEL,
    region: "AMERICA_NORTH",
    alias: "Prepared",
    puuid: testPuuid(account),
    riotId: { game_name: "Prepared", tag_line: "NA1" },
  });
}

function competitionPayload(): ConfirmationIntentPayload {
  return ConfirmationIntentPayloadSchema.parse({
    kind: "competition",
    guildId: GUILD,
    channelId: CHANNEL,
    title: "Prepared competition",
    description: "Prepared from Explore",
    visibility: "INVITE_ONLY",
    dates: {
      type: "FIXED_DATES",
      startDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
      endDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    },
    criteria: { type: "MOST_GAMES_PLAYED", queues: ["flex"] },
  });
}

let intentCounter = 0;
async function mintIntent(
  payload: ConfirmationIntentPayload,
  overrides?: {
    serverId?: DiscordGuildId;
    actorDiscordId?: DiscordAccountId;
    expiresAt?: Date;
  },
): Promise<string> {
  intentCounter += 1;
  const intent = await db.confirmationIntent.create({
    data: {
      kind: payload.kind,
      serverId: overrides?.serverId ?? GUILD,
      actorDiscordId: overrides?.actorDiscordId ?? ACTOR,
      payload: JSON.stringify(payload),
      idempotencyKey: `explore-creation-${intentCounter.toString()}`,
      expiresAt: overrides?.expiresAt ?? new Date(Date.now() + 60_000),
    },
  });
  return intent.id;
}

async function grant(...permissions: Permission[]): Promise<void> {
  await db.serverPermission.createMany({
    data: permissions.map((permission) => ({
      serverId: GUILD,
      discordUserId: ACTOR,
      permission: permissionKey(permission),
      grantedBy: ACTOR,
      grantedAt: new Date(),
    })),
  });
}

async function seedEnabledReport(title: string): Promise<void> {
  const now = new Date();
  await db.report.create({
    data: {
      serverId: GUILD,
      ownerId: ACTOR,
      channelId: CHANNEL,
      title,
      queryText: QUERY_TEXT,
      isEnabled: true,
      isSystemManaged: false,
      cronExpression: "0 12 * * 1",
      scheduleTimezone: "UTC",
      createdTime: now,
      updatedTime: now,
    },
  });
}

function caller(discordId: string = ACTOR) {
  return trpc.authedCaller(discordId);
}

beforeAll(async () => {
  await initFeatureFlags({
    environment: { FEATURE_FLAGS_MODE: "disabled" },
  });
});

beforeEach(async () => {
  await db.confirmationIntent.deleteMany();
  await db.auditLog.deleteMany();
  await db.reportScheduleOutbox.deleteMany();
  await db.report.deleteMany();
  await db.competitionParticipant.deleteMany();
  await db.competition.deleteMany();
  await db.subscription.deleteMany();
  await db.account.deleteMany();
  await db.player.deleteMany();
  await db.serverPermission.deleteMany();
  clearAllRateLimits();

  resetFlagOverrides("explore_creation_enabled");
  resetFlagOverrides("initial_match_history_import_enabled");
  addFlagOverride("explore_creation_enabled", true, { server: GUILD });
  trpc.setMembership([
    { guildId: GUILD, asAdmin: false },
    { guildId: OTHER_GUILD, asAdmin: false },
  ]);
  setAllowlist(`${GUILD},${OTHER_GUILD}`);
});

afterAll(async () => {
  resetFlagOverrides("explore_creation_enabled");
  resetFlagOverrides("initial_match_history_import_enabled");
  setAllowlist(undefined);
  await shutdownFeatureFlags();
  await db.$disconnect();
});

describe("explore.confirmCreationIntent — reports", () => {
  test("creates the same rows the web form creates, plus the audit row", async () => {
    await grant({ resource: "reports", action: "create" });
    const intentId = await mintIntent(reportPayload());

    const result = await caller().explore.confirmCreationIntent({ intentId });

    expect(result).toMatchObject({
      kind: "created",
      entity: "report",
      guildId: GUILD,
    });
    const reports = await db.report.findMany({ where: { serverId: GUILD } });
    expect(reports).toHaveLength(1);
    const [report] = reports;
    expect(report).toBeDefined();
    if (report === undefined) return;
    expect(report.ownerId).toBe(ACTOR);
    expect(report.queryText).toBe(QUERY_TEXT);
    expect(report.channelId).toBe(CHANNEL);

    const audits = await db.auditLog.findMany({ where: { serverId: GUILD } });
    expect(audits).toHaveLength(1);
    const [audit] = audits;
    expect(audit).toBeDefined();
    if (audit === undefined) return;
    expect(audit.action).toBe("REPORT_CREATE");
    expect(audit.actorDiscordId).toBe(ACTOR);
    expect(audit.targetChannelId).toBe(CHANNEL);
    expect(JSON.parse(audit.payload)).toMatchObject({
      reportId: report.id,
      via: "explore",
    });
  });

  test("enqueues the schedule-outbox row so the reconciler picks it up", async () => {
    await grant({ resource: "reports", action: "create" });
    const intentId = await mintIntent(reportPayload());

    await caller().explore.confirmCreationIntent({ intentId });

    const outbox = await db.reportScheduleOutbox.findMany();
    expect(outbox).toHaveLength(1);
  });

  test("re-checks the report limit inside the transaction", async () => {
    await grant({ resource: "reports", action: "create" });
    // reports_per_owner_per_server defaults to 2.
    await seedEnabledReport("Existing one");
    await seedEnabledReport("Existing two");
    const intentId = await mintIntent(reportPayload());

    const result = await caller().explore.confirmCreationIntent({ intentId });

    expect(result).toMatchObject({ kind: "limit_reached" });
    expect(await db.report.count({ where: { serverId: GUILD } })).toBe(2);
    expect(await db.auditLog.count({ where: { serverId: GUILD } })).toBe(0);
  });
});

describe("explore.confirmCreationIntent — subscriptions", () => {
  test("creates the player, account and subscription with an audit row", async () => {
    await grant({ resource: "subscriptions", action: "create" });
    const intentId = await mintIntent(subscriptionPayload());

    const result = await caller().explore.confirmCreationIntent({ intentId });

    expect(result).toMatchObject({
      kind: "created",
      entity: "subscription",
      guildId: GUILD,
    });
    expect(await db.player.count({ where: { serverId: GUILD } })).toBe(1);
    expect(await db.subscription.count({ where: { serverId: GUILD } })).toBe(1);

    const account = await db.account.findFirst({ where: { serverId: GUILD } });
    expect(account).not.toBeNull();
    // The stored Riot ID comes from the frozen Riot-canonical value, not from
    // whatever the agent typed.
    expect(account?.riotGameName).toBe("Prepared");
    expect(account?.riotTagLine).toBe("NA1");
    expect(account?.puuid).toBe(testPuuid("explore-creation"));

    const audit = await db.auditLog.findFirst({
      where: { serverId: GUILD, action: "SUBSCRIPTION_ADD" },
    });
    expect(audit).not.toBeNull();
    expect(JSON.parse(audit?.payload ?? "{}")).toMatchObject({
      via: "explore",
    });
  });

  test("reports an already-tracked account instead of creating a duplicate", async () => {
    await grant({ resource: "subscriptions", action: "create" });
    const first = await mintIntent(subscriptionPayload());
    await caller().explore.confirmCreationIntent({ intentId: first });
    const second = await mintIntent(subscriptionPayload());

    const result = await caller().explore.confirmCreationIntent({
      intentId: second,
    });

    expect(result).toMatchObject({ kind: "account_already_subscribed" });
    expect(await db.account.count({ where: { serverId: GUILD } })).toBe(1);
  });

  test("a second account on an already-subscribed player audits ACCOUNT_ADD, as the web form does", async () => {
    await grant({ resource: "subscriptions", action: "create" });
    const first = await mintIntent(subscriptionPayload());
    await caller().explore.confirmCreationIntent({ intentId: first });
    const smurf = await mintIntent(subscriptionPayload("explore-smurf"));

    const result = await caller().explore.confirmCreationIntent({
      intentId: smurf,
    });

    expect(result).toMatchObject({ kind: "subscription_already_exists" });
    // The account row still commits, so it still has to be audited.
    expect(await db.account.count({ where: { serverId: GUILD } })).toBe(2);
    expect(await db.subscription.count({ where: { serverId: GUILD } })).toBe(1);
    const audit = await db.auditLog.findFirst({
      where: { serverId: GUILD, action: "ACCOUNT_ADD" },
    });
    expect(audit).not.toBeNull();
    expect(JSON.parse(audit?.payload ?? "{}")).toMatchObject({
      via: "explore",
    });
  });
});

describe("explore.confirmCreationIntent — competitions", () => {
  test("an entrant that no longer exists is a refusal, not a server error", async () => {
    // The payload's entrant ids were written by the model when the intent was
    // prepared, so a player deleted since then is expected input at this
    // boundary rather than a broken caller. createCompetitionForActor lets the
    // enrollment throw so the half-built competition rolls back; that must
    // surface as an actionable refusal instead of an internal error the person
    // would hit again on every retry.
    await grant({ resource: "competitions", action: "create" });
    await grant({ resource: "competitions", action: "invite" });
    const payload = ConfirmationIntentPayloadSchema.parse({
      ...competitionPayload(),
      initialPlayerIds: [987_654_321],
    });
    const intentId = await mintIntent(payload);

    await expect(
      caller().explore.confirmCreationIntent({ intentId }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(await db.competition.count({ where: { serverId: GUILD } })).toBe(0);
  });

  test("creates the competition with a COMPETITION_CREATE audit row", async () => {
    await grant({ resource: "competitions", action: "create" });
    const intentId = await mintIntent(competitionPayload());

    const result = await caller().explore.confirmCreationIntent({ intentId });

    expect(result).toMatchObject({
      kind: "created",
      entity: "competition",
      guildId: GUILD,
    });
    expect(await db.competition.count({ where: { serverId: GUILD } })).toBe(1);
    const audit = await db.auditLog.findFirst({
      where: { serverId: GUILD, action: "COMPETITION_CREATE" },
    });
    expect(audit).not.toBeNull();
    expect(JSON.parse(audit?.payload ?? "{}")).toMatchObject({
      via: "explore",
    });
  });
});

describe("explore.confirmCreationIntent — authorization", () => {
  test("a permission revoked between minting and confirming is FORBIDDEN", async () => {
    // No grant seeded: the intent was minted while the actor could create, and
    // the grant has since been withdrawn.
    const intentId = await mintIntent(reportPayload());

    await expect(
      caller().explore.confirmCreationIntent({ intentId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.report.count()).toBe(0);
    expect(
      await db.confirmationIntent.count({ where: { consumedAt: null } }),
    ).toBe(1);
  });

  test("the wrong permission does not authorize another kind", async () => {
    await grant({ resource: "reports", action: "create" });
    const intentId = await mintIntent(competitionPayload());

    await expect(
      caller().explore.confirmCreationIntent({ intentId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.competition.count()).toBe(0);
  });

  test("an intent in another guild is NOT_FOUND, not FORBIDDEN", async () => {
    await grant({ resource: "reports", action: "create" });
    // The caller belongs to OTHER_GUILD too, so this is specifically about the
    // intent's guild, not about membership.
    const intentId = await mintIntent(reportPayload(OTHER_GUILD), {
      serverId: OTHER_GUILD,
    });
    trpc.setMembership([{ guildId: GUILD, asAdmin: false }]);

    await expect(
      caller().explore.confirmCreationIntent({ intentId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("another person's intent is NOT_FOUND, not FORBIDDEN", async () => {
    await grant({ resource: "reports", action: "create" });
    const intentId = await mintIntent(reportPayload(), {
      actorDiscordId: STRANGER,
    });

    await expect(
      caller().explore.confirmCreationIntent({ intentId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await db.report.count()).toBe(0);
  });

  test("a dare intent cannot be confirmed through the creation procedure", async () => {
    await grant({ resource: "reports", action: "create" });
    const dare = await db.bucksDareV2.create({
      data: {
        serverId: GUILD,
        channelId: CHANNEL,
        challengerDiscordId: ACTOR,
        openingStake: 20,
      },
    });
    const intent = await db.confirmationIntent.create({
      data: {
        kind: "dare_fund",
        serverId: GUILD,
        dareId: dare.id,
        expectedRevision: 1,
        actorDiscordId: ACTOR,
        payload: JSON.stringify({ kind: "dare_fund" }),
        idempotencyKey: "explore-creation-dare",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    await expect(
      caller().explore.confirmCreationIntent({ intentId: intent.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const stored = await db.confirmationIntent.findUniqueOrThrow({
      where: { id: intent.id },
    });
    expect(stored.consumedAt).toBeNull();
    await db.bucksDareV2.deleteMany();
  });

  test("revoking the feature flag blocks an already-pending intent", async () => {
    await grant({ resource: "reports", action: "create" });
    const intentId = await mintIntent(reportPayload());
    resetFlagOverrides("explore_creation_enabled");

    await expect(
      caller().explore.confirmCreationIntent({ intentId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.report.count()).toBe(0);
  });

  test("an unauthenticated caller is rejected", async () => {
    const intentId = await mintIntent(reportPayload());

    await expect(
      trpc.anonCaller().explore.confirmCreationIntent({ intentId }),
    ).rejects.toThrow();
  });
});

describe("explore.confirmCreationIntent — single use", () => {
  test("an expired intent creates nothing", async () => {
    await grant({ resource: "reports", action: "create" });
    const intentId = await mintIntent(reportPayload(), {
      expiresAt: new Date(Date.now() - 1000),
    });

    const result = await caller().explore.confirmCreationIntent({ intentId });

    expect(result).toEqual({ kind: "intent_expired" });
    expect(await db.report.count()).toBe(0);
  });

  test("a second confirmation replays the outcome and creates nothing", async () => {
    await grant({ resource: "reports", action: "create" });
    const intentId = await mintIntent(reportPayload());

    const first = await caller().explore.confirmCreationIntent({ intentId });
    const second = await caller().explore.confirmCreationIntent({ intentId });

    expect(first).toMatchObject({ kind: "created" });
    expect(second).toMatchObject({ kind: "already_consumed" });
    expect(await db.report.count({ where: { serverId: GUILD } })).toBe(1);
    expect(await db.auditLog.count({ where: { serverId: GUILD } })).toBe(1);
  });

  test("two concurrent confirmations create exactly one entity", async () => {
    await grant({ resource: "reports", action: "create" });
    const intentId = await mintIntent(reportPayload());

    const results = await Promise.all([
      caller().explore.confirmCreationIntent({ intentId }),
      caller().explore.confirmCreationIntent({ intentId }),
    ]);

    expect(results.filter((r) => r.kind === "created")).toHaveLength(1);
    expect(await db.report.count({ where: { serverId: GUILD } })).toBe(1);
    expect(await db.auditLog.count({ where: { serverId: GUILD } })).toBe(1);
  });
});

describe("explore.creationIntentStatus", () => {
  test("reports pending, then consumed with the stored outcome", async () => {
    await grant({ resource: "reports", action: "create" });
    const intentId = await mintIntent(reportPayload());

    const pending = await caller().explore.creationIntentStatus({ intentId });
    expect(pending).toMatchObject({
      state: "pending",
      kind: "report",
      guildId: GUILD,
      result: null,
    });

    await caller().explore.confirmCreationIntent({ intentId });
    const consumed = await caller().explore.creationIntentStatus({ intentId });
    expect(consumed.state).toBe("consumed");
    expect(consumed.result).toMatchObject({ kind: "created" });
  });

  test("hides another person's intent", async () => {
    const intentId = await mintIntent(reportPayload(), {
      actorDiscordId: STRANGER,
    });

    await expect(
      caller().explore.creationIntentStatus({ intentId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("is blocked when the feature flag is off", async () => {
    const intentId = await mintIntent(reportPayload());
    resetFlagOverrides("explore_creation_enabled");

    await expect(
      caller().explore.creationIntentStatus({ intentId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
