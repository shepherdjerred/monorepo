import type { ExtendedPrismaClient } from "#src/database/index.ts";
import type { TournamentApiMode } from "#src/configuration/tournament-mode.ts";
import type { TournamentRegion } from "@scout-for-lol/data/index.ts";

export type TournamentRegistrationRecord = {
  readonly providerId: number;
  readonly tournamentId: number;
  readonly callbackUrl: string;
};

/**
 * The provider/tournament pair for a region, or a hard failure naming the fix.
 *
 * Deliberately does NOT create one on demand. Lazy create-or-reuse is the
 * defensive branch the repo bans, and here it has teeth: two concurrent
 * `/lobby create` calls would race into two providers, and a fresh volume
 * would silently mint a new registration on every restart rather than telling
 * an operator that state is missing.
 */
export async function requireTournamentRegistration(
  client: ExtendedPrismaClient,
  apiMode: TournamentApiMode,
  region: TournamentRegion,
): Promise<TournamentRegistrationRecord> {
  const registration = await client.tournamentRegistration.findUnique({
    where: { apiMode_tournamentRegion: { apiMode, tournamentRegion: region } },
  });

  if (registration === null) {
    throw new Error(
      `No tournament registration for region ${region} in ${apiMode} mode. ` +
        `Run: bun run scripts/register-tournament-provider.ts --mode=${apiMode} --region=${region}`,
    );
  }

  return {
    providerId: registration.providerId,
    tournamentId: registration.tournamentId,
    callbackUrl: registration.callbackUrl,
  };
}

export async function saveTournamentRegistration(
  client: ExtendedPrismaClient,
  input: {
    apiMode: TournamentApiMode;
    region: TournamentRegion;
    providerId: number;
    tournamentId: number;
    callbackUrl: string;
    name: string;
  },
): Promise<void> {
  await client.tournamentRegistration.upsert({
    where: {
      apiMode_tournamentRegion: {
        apiMode: input.apiMode,
        tournamentRegion: input.region,
      },
    },
    create: {
      apiMode: input.apiMode,
      tournamentRegion: input.region,
      providerId: input.providerId,
      tournamentId: input.tournamentId,
      callbackUrl: input.callbackUrl,
      name: input.name,
    },
    update: {
      providerId: input.providerId,
      tournamentId: input.tournamentId,
      callbackUrl: input.callbackUrl,
      name: input.name,
    },
  });
}
