import { describe, expect, test } from "vitest";
import * as domainDatabaseIds from "@scout-for-lol/domain/identity/database-ids.ts";
import * as domainDiscord from "@scout-for-lol/domain/identity/discord.ts";
import * as domainLeagueAccount from "@scout-for-lol/domain/identity/league-account.ts";
import * as domainRoutes from "@scout-for-lol/domain/identity/routes.ts";
import * as dataCompetition from "#src/model/competition.ts";
import * as dataDiscord from "#src/model/discord.ts";
import * as dataLeagueAccount from "#src/model/league-account.ts";
import * as dataRoutes from "#src/model/routes.ts";

/**
 * The schemas moved to @scout-for-lol/domain are re-exported by their old
 * data modules. Existing import sites rely on receiving the SAME schema
 * object — not an equivalent copy — so a value branded through one package
 * is branded through the other.
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

  test("database row id schemas", () => {
    expect(dataCompetition.PlayerIdSchema).toBe(
      domainDatabaseIds.PlayerIdSchema,
    );
    expect(dataCompetition.AccountIdSchema).toBe(
      domainDatabaseIds.AccountIdSchema,
    );
  });
});
