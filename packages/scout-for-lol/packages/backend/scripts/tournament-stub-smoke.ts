/**
 * Operator smoke test for the tournament client, against real Riot.
 *
 * This is the only thing that can validate host routing, the auth header, and
 * error shapes before the Riot key has tournament access — tournament-stub-v5
 * answers a development or standard League key, so it runs today.
 *
 * What it does NOT validate is the feature: stub codes do not create an
 * in-client lobby, its lobby events are canned, and `games/by-code` does not
 * exist there at all. A green run means our request/parse layer is correct,
 * not that a lobby works.
 *
 *   cd packages/scout-for-lol/packages/backend
 *   op run --env-file=../../dev-web.env.tpl -- bun run scripts/tournament-stub-smoke.ts
 *
 * Not wired into CI: it makes live Riot calls and registers a provider.
 */
import { z } from "zod";
import {
  createTournamentCodes,
  getLobbyEvents,
  getTournamentCode,
  registerProvider,
  registerTournament,
} from "#src/league/api/tournament/client.ts";
import { toTournamentRegion } from "#src/league/api/tournament/regions.ts";
import { tournamentBasePath } from "#src/league/api/tournament/mode.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("tournament-stub-smoke");

const FlagsSchema = z.object({
  region: z.string().default("AMERICA_NORTH"),
  callbackUrl: z
    .url()
    .default("https://beta.scout-for-lol.com/api/riot/tournament-callback"),
});

const RegionSchema = z.enum([
  "BRAZIL",
  "EU_EAST",
  "EU_WEST",
  "JAPAN",
  "KOREA",
  "LAT_NORTH",
  "LAT_SOUTH",
  "AMERICA_NORTH",
  "OCEANIA",
  "PBE",
  "RUSSIA",
  "TURKEY",
  "SINGAPORE",
  "TAIWAN",
  "VIETNAM",
]);

function parseFlags(argv: string[]) {
  const raw: Record<string, string> = {};
  for (const argument of argv) {
    const matched = /^--([\w-]+)=(.*)$/.exec(argument);
    if (matched === null) {
      throw new Error(`unrecognized argument: ${argument}`);
    }
    const [, key, value] = matched;
    if (key === undefined || value === undefined) {
      throw new Error(`unrecognized argument: ${argument}`);
    }
    raw[
      key.replaceAll(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
    ] = value;
  }
  return FlagsSchema.parse(raw);
}

const flags = parseFlags(Bun.argv.slice(2));
const region = RegionSchema.parse(flags.region);
const options = { mode: "stub" } as const;

logger.info(
  `Smoke-testing ${tournamentBasePath(options.mode)} against americas.api.riotgames.com`,
);

const providerId = await registerProvider(options, {
  region: toTournamentRegion(region),
  url: flags.callbackUrl,
});
logger.info(`providerId=${providerId.toString()}`);

const tournamentId = await registerTournament(options, {
  providerId,
  name: "scout-smoke",
});
logger.info(`tournamentId=${tournamentId.toString()}`);

const codes = await createTournamentCodes(options, tournamentId, 1, {
  teamSize: 5,
  pickType: "TOURNAMENT_DRAFT",
  mapType: "SUMMONERS_RIFT",
  spectatorType: "ALL",
  enoughPlayers: false,
});
const code = codes[0];
if (code === undefined) {
  throw new Error("Riot returned no tournament code");
}
logger.info(`code=${code}`);

const detail = await getTournamentCode(options, code);
logger.info(
  `code detail parsed: map=${detail.map} teamSize=${detail.teamSize.toString()} spectators=${detail.spectators}`,
);

const events = await getLobbyEvents(options, code);
logger.info(
  events === undefined
    ? "lobby-events returned no body (expected on a fresh stub code)"
    : `lobby-events parsed: ${events.length.toString()} event(s)`,
);

logger.info(
  "✅ Routing, auth header, and every response schema validated against real Riot.",
);
