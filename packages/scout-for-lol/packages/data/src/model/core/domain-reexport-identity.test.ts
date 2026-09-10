import { describe, expect, test } from "vitest";
import * as domainBucksMoney from "@scout-for-lol/domain/identity/bucks-money.ts";
import * as domainDatabaseIds from "@scout-for-lol/domain/identity/database-ids.ts";
import * as domainDiscord from "@scout-for-lol/domain/identity/discord.ts";
import * as domainLeagueAccount from "@scout-for-lol/domain/identity/league-account.ts";
import * as domainRoutes from "@scout-for-lol/domain/identity/routes.ts";
import * as dataBucksMoney from "#src/model/bucks/bryan-bucks-money.ts";
import * as dataCompetition from "#src/model/competitions/competition.ts";
import * as dataDiscord from "#src/model/core/discord.ts";
import * as dataLeagueAccount from "#src/model/riot/league-account.ts";
import * as dataRoutes from "#src/model/core/routes.ts";

/**
 * The schemas moved to @scout-for-lol/domain are re-exported by their old
 * data modules. Existing import sites rely on receiving the SAME schema
 * object — not an equivalent copy — so a value branded through one package
 * is branded through the other.
 *
 * MAINTENANCE: this suite is hand-enumerated. When another schema moves from
 * data to domain behind a re-export shim, add a matching `toBe` assertion
 * here — nothing else fails if the new shim silently exports a copy.
 */
describe("data re-exports the identical domain schema objects", () => {
  test("discord identifier schemas", () => {
    expect(dataDiscord.DiscordGuildIdSchema).toBe(
      domainDiscord.DiscordGuildIdSchema,
    );
    expect(dataDiscord.DiscordAccountIdSchema).toBe(
      domainDiscord.DiscordAccountIdSchema,
    );
    expect(dataDiscord.DiscordChannelIdSchema).toBe(
      domainDiscord.DiscordChannelIdSchema,
    );
  });

  test("league identifier schemas", () => {
    expect(dataLeagueAccount.LeaguePuuidSchema).toBe(
      domainLeagueAccount.LeaguePuuidSchema,
    );
    expect(dataLeagueAccount.LeagueSummonerIdSchema).toBe(
      domainLeagueAccount.LeagueSummonerIdSchema,
    );
  });

  test("routing schemas", () => {
    expect(dataRoutes.PlatformRouteSchema).toBe(
      domainRoutes.PlatformRouteSchema,
    );
    expect(dataRoutes.RegionalRouteSchema).toBe(
      domainRoutes.RegionalRouteSchema,
    );
    expect(dataRoutes.AccountRegionalRouteSchema).toBe(
      domainRoutes.AccountRegionalRouteSchema,
    );
  });

  test("Bryan Bucks money schemas", () => {
    expect(dataBucksMoney.BucksStakeSchema).toBe(
      domainBucksMoney.BucksStakeSchema,
    );
    expect(dataBucksMoney.BucksAmountSchema).toBe(
      domainBucksMoney.BucksAmountSchema,
    );
    expect(dataBucksMoney.BucksDeltaSchema).toBe(
      domainBucksMoney.BucksDeltaSchema,
    );
    expect(dataBucksMoney.BucksPoolTotalSchema).toBe(
      domainBucksMoney.BucksPoolTotalSchema,
    );
    // The storable schemas are built ON the domain ones here in data, so they
    // are deliberately NOT the same object — only their base must be.
    expect(dataBucksMoney.StorableBucksStakeSchema).not.toBe(
      domainBucksMoney.BucksStakeSchema,
    );
  });

  test("database row id schemas", () => {
    expect(dataCompetition.PlayerIdSchema).toBe(
      domainDatabaseIds.PlayerIdSchema,
    );
    expect(dataCompetition.AccountIdSchema).toBe(
      domainDatabaseIds.AccountIdSchema,
    );
  });
});
