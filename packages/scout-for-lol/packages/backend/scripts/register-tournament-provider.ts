/**
 * Registers a tournament provider and tournament, and records the result.
 *
 * These are long-lived registrations produced by an API call — not per-game
 * state, not a credential. They are created deliberately by an operator rather
 * than lazily on first use: lazy creation would race two concurrent
 * `/lobby create` calls into two providers, and would silently mint a new
 * registration on a fresh volume instead of reporting that state is missing.
 *
 *   cd packages/scout-for-lol/packages/backend
 *   op run --env-file=../../dev-web.env.tpl -- \
 *     bun run scripts/register-tournament-provider.ts --mode=stub --region=AMERICA_NORTH
 *
 * The callback URL is required by Riot at provider registration (http on 80 or
 * https on 443, approved gTLD). Scout's handler acknowledges and discards; the
 * poller is what actually drives the lobby.
 */
import { z } from "zod";
import { prisma } from "#src/database/index.ts";
import {
  registerProvider,
  registerTournament,
} from "#src/league/api/tournament/client.ts";
import { toTournamentRegion } from "#src/league/api/tournament/regions.ts";
import { TournamentApiModeSchema } from "#src/league/api/tournament/mode.ts";
import { saveTournamentRegistration } from "#src/league/tournament/registration.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("register-tournament-provider");

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

// A closed flag set: an unknown --flag fails parsing rather than being ignored.
const FlagsSchema = z.strictObject({
  mode: TournamentApiModeSchema,
  region: RegionSchema,
  callbackUrl: z
    .url()
    .default("https://beta.scout-for-lol.com/api/riot/tournament-callback"),
  name: z.string().min(1).default("Scout custom lobbies"),
});

function parseFlags(argv: string[]) {
  const raw: Record<string, string> = {};
  for (const argument of argv) {
    const matched = /^--([\w-]+)=(.*)$/.exec(argument);
    const key = matched?.[1];
    const value = matched?.[2];
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
const tournamentRegion = toTournamentRegion(flags.region);
const options = { mode: flags.mode } as const;

logger.info(
  `Registering a ${flags.mode} tournament provider for ${tournamentRegion}`,
);

const providerId = await registerProvider(options, {
  region: tournamentRegion,
  url: flags.callbackUrl,
});

const tournamentId = await registerTournament(options, {
  providerId,
  name: flags.name,
});

await saveTournamentRegistration(prisma, {
  apiMode: flags.mode,
  region: tournamentRegion,
  providerId,
  tournamentId,
  callbackUrl: flags.callbackUrl,
  name: flags.name,
});

logger.info(
  `✅ Registered providerId=${providerId.toString()} tournamentId=${tournamentId.toString()} for ${tournamentRegion} (${flags.mode})`,
);

await prisma.$disconnect();
