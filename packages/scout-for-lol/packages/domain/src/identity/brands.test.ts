import { describe, expect, expectTypeOf, test } from "vitest";
import {
  type DiscordMessageId,
  DiscordMessageIdSchema,
  type DurationSeconds,
  DurationSecondsSchema,
  IsoInstantSchema,
  NotificationIntentKeySchema,
  type RecoveryBatchId,
  RecoveryBatchIdSchema,
  type RiotMatchId,
  RiotMatchIdSchema,
  type S3ObjectKey,
  S3ObjectKeySchema,
  Sha256DigestSchema,
  type WorkflowRunId,
  WorkflowRunIdSchema,
} from "#src/identity/brands.ts";
import {
  type DiscordAccountId,
  type DiscordChannelId,
  type DiscordGuildId,
  DiscordGuildIdSchema,
} from "#src/identity/discord.ts";
import {
  type LeaguePuuid,
  LeaguePuuidSchema,
  type LeagueSummonerId,
  LeagueSummonerIdSchema,
} from "#src/identity/league-account.ts";
import { PlatformRouteSchema } from "#src/identity/routes.ts";
import {
  type AccountId,
  AccountIdSchema,
  type PlayerId,
  PlayerIdSchema,
} from "#src/identity/database-ids.ts";

describe("RiotMatchIdSchema", () => {
  test("accepts a platform route, underscore, and digits", () => {
    expect(RiotMatchIdSchema.safeParse("NA1_5312279829").success).toBe(true);
    expect(RiotMatchIdSchema.safeParse("KR_1").success).toBe(true);
  });

  test("accepts every platform route the enum declares", () => {
    for (const platform of PlatformRouteSchema.options) {
      expect(RiotMatchIdSchema.safeParse(`${platform}_123`).success).toBe(true);
    }
  });

  test("rejects unknown platforms, wrong separators, and casing", () => {
    expect(RiotMatchIdSchema.safeParse("XX9_123").success).toBe(false);
    expect(RiotMatchIdSchema.safeParse("NA1-123").success).toBe(false);
    expect(RiotMatchIdSchema.safeParse("na1_123").success).toBe(false);
    expect(RiotMatchIdSchema.safeParse("NA1_").success).toBe(false);
    expect(RiotMatchIdSchema.safeParse("NA1_12a").success).toBe(false);
    expect(RiotMatchIdSchema.safeParse("_123").success).toBe(false);
    expect(RiotMatchIdSchema.safeParse("").success).toBe(false);
  });
});

describe("DiscordMessageIdSchema", () => {
  test("accepts snowflakes of 17 to 20 digits", () => {
    expect(DiscordMessageIdSchema.safeParse("12345678901234567").success).toBe(
      true,
    );
    expect(
      DiscordMessageIdSchema.safeParse("12345678901234567890").success,
    ).toBe(true);
  });

  test("rejects wrong lengths and non-digits", () => {
    expect(DiscordMessageIdSchema.safeParse("1234567890123456").success).toBe(
      false,
    );
    expect(
      DiscordMessageIdSchema.safeParse("123456789012345678901").success,
    ).toBe(false);
    expect(DiscordMessageIdSchema.safeParse("1234567890123456a").success).toBe(
      false,
    );
  });
});

describe("opaque string key brands", () => {
  test("accept non-empty strings", () => {
    expect(WorkflowRunIdSchema.safeParse("7d0f6f3a-run").success).toBe(true);
    expect(RecoveryBatchIdSchema.safeParse("batch-2026-09-06").success).toBe(
      true,
    );
    expect(
      NotificationIntentKeySchema.safeParse("dare-settled/NA1_1/123").success,
    ).toBe(true);
  });

  test("reject the empty string", () => {
    expect(WorkflowRunIdSchema.safeParse("").success).toBe(false);
    expect(RecoveryBatchIdSchema.safeParse("").success).toBe(false);
    expect(NotificationIntentKeySchema.safeParse("").success).toBe(false);
  });

  test("reject non-strings", () => {
    expect(WorkflowRunIdSchema.safeParse(42).success).toBe(false);
    expect(RecoveryBatchIdSchema.safeParse(null).success).toBe(false);
    expect(NotificationIntentKeySchema.safeParse(undefined).success).toBe(
      false,
    );
  });
});

describe("S3ObjectKeySchema", () => {
  test("accepts a realistic object key", () => {
    expect(
      S3ObjectKeySchema.safeParse("games/2026/09/06/NA1_5312279829/match.json")
        .success,
    ).toBe(true);
  });

  test("rejects the empty string and keys beyond S3's 1024-byte limit", () => {
    expect(S3ObjectKeySchema.safeParse("").success).toBe(false);
    expect(S3ObjectKeySchema.safeParse("k".repeat(1024)).success).toBe(true);
    expect(S3ObjectKeySchema.safeParse("k".repeat(1025)).success).toBe(false);
  });

  test("measures the limit in UTF-8 bytes, not characters", () => {
    // 600 characters but 1200 UTF-8 bytes: within a code-unit limit,
    // over the byte limit S3 actually enforces.
    expect(S3ObjectKeySchema.safeParse("é".repeat(600)).success).toBe(false);
    // 512 two-byte characters = 1024 bytes: exactly at the limit.
    expect(S3ObjectKeySchema.safeParse("é".repeat(512)).success).toBe(true);
  });
});

describe("Sha256DigestSchema", () => {
  const digest =
    "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

  test("accepts 64 lowercase hex characters", () => {
    expect(Sha256DigestSchema.safeParse(digest).success).toBe(true);
  });

  test("rejects uppercase, wrong lengths, and non-hex characters", () => {
    expect(Sha256DigestSchema.safeParse(digest.toUpperCase()).success).toBe(
      false,
    );
    expect(Sha256DigestSchema.safeParse(digest.slice(0, 63)).success).toBe(
      false,
    );
    expect(Sha256DigestSchema.safeParse(`${digest}0`).success).toBe(false);
    expect(
      Sha256DigestSchema.safeParse(`${digest.slice(0, 63)}g`).success,
    ).toBe(false);
  });
});

describe("IsoInstantSchema", () => {
  test("accepts UTC and numeric-offset instants", () => {
    expect(IsoInstantSchema.safeParse("2026-09-06T12:00:00Z").success).toBe(
      true,
    );
    expect(
      IsoInstantSchema.safeParse("2026-09-06T12:00:00.123+02:00").success,
    ).toBe(true);
  });

  test("rejects dates, offsetless timestamps, and garbage", () => {
    expect(IsoInstantSchema.safeParse("2026-09-06").success).toBe(false);
    expect(IsoInstantSchema.safeParse("2026-09-06T12:00:00").success).toBe(
      false,
    );
    expect(IsoInstantSchema.safeParse("not an instant").success).toBe(false);
  });
});

describe("DurationSecondsSchema", () => {
  test("accepts non-negative integers", () => {
    expect(DurationSecondsSchema.safeParse(0).success).toBe(true);
    expect(DurationSecondsSchema.safeParse(3600).success).toBe(true);
  });

  test("rejects negatives, fractions, and strings", () => {
    expect(DurationSecondsSchema.safeParse(-1).success).toBe(false);
    expect(DurationSecondsSchema.safeParse(1.5).success).toBe(false);
    expect(DurationSecondsSchema.safeParse("60").success).toBe(false);
  });
});

describe("moved identity brands keep their runtime rules", () => {
  test("Discord ids require 17 to 20 digits", () => {
    expect(DiscordGuildIdSchema.safeParse("12345678901234567").success).toBe(
      true,
    );
    expect(DiscordGuildIdSchema.safeParse("123").success).toBe(false);
    expect(DiscordGuildIdSchema.safeParse("1234567890123456a").success).toBe(
      false,
    );
  });

  test("LeaguePuuid requires exactly 78 characters", () => {
    expect(LeaguePuuidSchema.safeParse("p".repeat(78)).success).toBe(true);
    expect(LeaguePuuidSchema.safeParse("p".repeat(77)).success).toBe(false);
  });

  test("LeagueSummonerId requires 1 to 63 characters", () => {
    expect(LeagueSummonerIdSchema.safeParse("").success).toBe(false);
    expect(LeagueSummonerIdSchema.safeParse("s".repeat(63)).success).toBe(true);
    expect(LeagueSummonerIdSchema.safeParse("s".repeat(64)).success).toBe(
      false,
    );
  });

  test("PlatformRoute rejects unknown routes", () => {
    expect(PlatformRouteSchema.safeParse("NA1").success).toBe(true);
    expect(PlatformRouteSchema.safeParse("XX9").success).toBe(false);
  });

  test("PlayerId and AccountId require positive integers", () => {
    expect(PlayerIdSchema.safeParse(1).success).toBe(true);
    expect(PlayerIdSchema.safeParse(0).success).toBe(false);
    expect(AccountIdSchema.safeParse(7).success).toBe(true);
    expect(AccountIdSchema.safeParse(-7).success).toBe(false);
  });
});

describe("brands are not interchangeable at the type level", () => {
  test("distinct brands over the same base type do not extend each other", () => {
    expectTypeOf<DiscordGuildId>().not.toExtend<DiscordAccountId>();
    expectTypeOf<DiscordAccountId>().not.toExtend<DiscordChannelId>();
    expectTypeOf<DiscordMessageId>().not.toExtend<DiscordAccountId>();
    expectTypeOf<LeaguePuuid>().not.toExtend<LeagueSummonerId>();
    expectTypeOf<PlayerId>().not.toExtend<AccountId>();
    expectTypeOf<AccountId>().not.toExtend<PlayerId>();
    expectTypeOf<WorkflowRunId>().not.toExtend<RecoveryBatchId>();
    expectTypeOf<RiotMatchId>().not.toExtend<S3ObjectKey>();
  });

  test("unbranded base values do not satisfy a brand", () => {
    expectTypeOf<string>().not.toExtend<DiscordGuildId>();
    expectTypeOf<string>().not.toExtend<RiotMatchId>();
    expectTypeOf<number>().not.toExtend<DurationSeconds>();
    expectTypeOf<number>().not.toExtend<PlayerId>();
  });
});
