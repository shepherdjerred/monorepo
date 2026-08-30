import { z } from "zod";
import type {
  DiscordAccountId,
  DiscordChannelId,
  DiscordGuildId,
  RawTournamentCodeParameters,
  Region,
  TournamentMapType,
  TournamentPickType,
  TournamentSpectatorType,
} from "@scout-for-lol/data/index.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import type { TournamentApiMode } from "#src/configuration/tournament-mode.ts";
import { createTournamentCodes } from "#src/league/api/tournament/client.ts";
import {
  toPlatformId,
  toTournamentRegion,
} from "#src/league/api/tournament/regions.ts";
import { requireTournamentRegistration } from "#src/league/tournament/registration.ts";
import {
  LOBBY_ABANDON_TTL_MS,
  lobbyCreateData,
  parseLobbyRow,
  type TournamentLobbyRecord,
} from "#src/league/tournament/lobby-store.ts";

const UniqueViolationSchema = z.object({ code: z.literal("P2002") });
const ProvisionStateSchema = z.enum(["PENDING", "AMBIGUOUS", "COMPLETED"]);

/**
 * A PENDING claim this old belongs to a process that can no longer prove
 * whether Riot accepted its POST. It becomes AMBIGUOUS instead of being
 * leased to a retry, because a second POST could mint a second credential.
 */
export const PROVISION_PENDING_TTL_MS = 5 * 60 * 1000;

type ResolvedSide = {
  readonly aliases: string[];
  readonly puuids: string[];
  readonly region: Region;
};

type ProvisionTournamentLobbyBase = {
  readonly requestId: string;
  readonly mode: TournamentApiMode;
  readonly serverId: DiscordGuildId;
  readonly channelId: DiscordChannelId;
  readonly creatorDiscordId: DiscordAccountId;
  readonly pickType: TournamentPickType;
  readonly mapType: TournamentMapType;
  readonly spectatorType: TournamentSpectatorType;
  readonly lobbyName?: string;
  readonly password?: string;
};

type DeclaredRosterProvision = {
  readonly blue: ResolvedSide;
  readonly red: ResolvedSide;
  readonly teamSize?: never;
  readonly region?: never;
};

type OpenProvision = {
  readonly region: Region;
  readonly teamSize: number;
  readonly blue?: never;
  readonly red?: never;
};

export type ProvisionTournamentLobbyInput = ProvisionTournamentLobbyBase &
  (DeclaredRosterProvision | OpenProvision);

type ProvisionDependencies = {
  readonly createCodes: typeof createTournamentCodes;
  readonly now: () => Date;
};

const DEFAULT_DEPENDENCIES: ProvisionDependencies = {
  createCodes: createTournamentCodes,
  now: () => new Date(),
};

function requestHash(input: ProvisionTournamentLobbyInput): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(
    JSON.stringify({
      mode: input.mode,
      serverId: input.serverId,
      channelId: input.channelId,
      creatorDiscordId: input.creatorDiscordId,
      region: "region" in input ? input.region : input.blue.region,
      teamSize: "teamSize" in input ? input.teamSize : undefined,
      blue: "blue" in input ? input.blue : undefined,
      red: "red" in input ? input.red : undefined,
      pickType: input.pickType,
      mapType: input.mapType,
      spectatorType: input.spectatorType,
      lobbyName: input.lobbyName,
      password: input.password,
    }),
  );
  return hasher.digest("hex");
}

async function markAmbiguous(
  client: ExtendedPrismaClient,
  requestId: string,
  error: unknown,
): Promise<void> {
  await client.tournamentLobbyProvision.updateMany({
    where: { id: requestId, state: "PENDING" },
    data: {
      state: "AMBIGUOUS",
      lastError: error instanceof Error ? error.message : String(error),
    },
  });
}

async function claimProvision(
  client: ExtendedPrismaClient,
  input: ProvisionTournamentLobbyInput,
  hash: string,
  now: Date,
): Promise<TournamentLobbyRecord | undefined> {
  try {
    await client.tournamentLobbyProvision.create({
      data: { id: input.requestId, requestHash: hash, claimedAt: now },
    });
    return undefined;
  } catch (error) {
    if (!UniqueViolationSchema.safeParse(error).success) throw error;
  }

  const sameRequest = await client.tournamentLobbyProvision.findUnique({
    where: { id: input.requestId },
    include: { lobby: true },
  });
  const existing =
    sameRequest ??
    (await client.tournamentLobbyProvision.findFirstOrThrow({
      where: {
        requestHash: hash,
        state: { in: ["PENDING", "AMBIGUOUS"] },
      },
      include: { lobby: true },
    }));
  if (existing.requestHash !== hash) {
    throw new Error(
      `Tournament provisioning request ${input.requestId} was reused with different lobby inputs`,
    );
  }

  const state = ProvisionStateSchema.parse(existing.state);
  if (state === "COMPLETED") {
    if (existing.lobby === null) {
      throw new Error(
        `Completed tournament provisioning request ${input.requestId} has no lobby`,
      );
    }
    return parseLobbyRow(existing.lobby);
  }
  if (state === "AMBIGUOUS") {
    throw new Error(
      `Equivalent tournament provisioning request ${existing.id} has an ambiguous Riot outcome and requires operator recovery`,
    );
  }

  const ageMs = now.getTime() - existing.claimedAt.getTime();
  if (ageMs <= PROVISION_PENDING_TTL_MS) {
    throw new Error(
      `Equivalent tournament provisioning request ${existing.id} is already in progress`,
    );
  }

  await markAmbiguous(
    client,
    existing.id,
    new Error("Provisioning process ended before recording Riot's response"),
  );
  throw new Error(
    `Equivalent tournament provisioning request ${existing.id} expired with an ambiguous Riot outcome and requires operator recovery`,
  );
}

/**
 * The single code-provisioning path for `/lobby` and Customs.
 *
 * The registration lookup is read-only and happens before the durable claim.
 * Everything after the claim is ambiguity-sensitive: no failure path makes a
 * second Tournament-V5 request for the same operation.
 */
export async function provisionTournamentLobby(
  client: ExtendedPrismaClient,
  input: ProvisionTournamentLobbyInput,
  dependencies: ProvisionDependencies = DEFAULT_DEPENDENCIES,
): Promise<TournamentLobbyRecord> {
  const hasDeclaredRoster = "blue" in input;
  const region = hasDeclaredRoster ? input.blue.region : input.region;

  if (hasDeclaredRoster && input.blue.region !== input.red.region) {
    throw new Error("Tournament lobby teams must use the same Riot region");
  }

  const tournamentRegion = toTournamentRegion(region);
  const registration = await requireTournamentRegistration(
    client,
    input.mode,
    tournamentRegion,
  );
  const hash = requestHash(input);
  const existing = await claimProvision(
    client,
    input,
    hash,
    dependencies.now(),
  );
  if (existing !== undefined) return existing;

  const teamSize = hasDeclaredRoster
    ? Math.max(input.blue.puuids.length, input.red.puuids.length)
    : input.teamSize;
  const parameters: RawTournamentCodeParameters = {
    teamSize,
    pickType: input.pickType,
    mapType: input.mapType,
    spectatorType: input.spectatorType,
    enoughPlayers: false,
    ...(hasDeclaredRoster
      ? {
          allowedParticipants: [...input.blue.puuids, ...input.red.puuids],
        }
      : {}),
  };

  let code: string;
  try {
    const codes = await dependencies.createCodes(
      { mode: input.mode },
      registration.tournamentId,
      1,
      parameters,
    );
    const returnedCode = codes[0];
    if (returnedCode === undefined) {
      throw new Error("Riot returned no tournament code");
    }
    code = returnedCode;
  } catch (error) {
    await markAmbiguous(client, input.requestId, error);
    throw error;
  }

  try {
    const row = await client.$transaction(async (transaction) => {
      const lobby = await transaction.tournamentLobby.create({
        data: lobbyCreateData({
          code,
          apiMode: input.mode,
          providerId: registration.providerId,
          tournamentId: registration.tournamentId,
          region,
          platformId: toPlatformId(region),
          serverId: input.serverId,
          channelId: input.channelId,
          creatorDiscordId: input.creatorDiscordId,
          bluePuuids: hasDeclaredRoster ? [...input.blue.puuids] : [],
          redPuuids: hasDeclaredRoster ? [...input.red.puuids] : [],
          blueAliases: hasDeclaredRoster ? [...input.blue.aliases] : [],
          redAliases: hasDeclaredRoster ? [...input.red.aliases] : [],
          teamSize,
          pickType: input.pickType,
          mapType: input.mapType,
          spectatorType: input.spectatorType,
          lobbyName: input.lobbyName,
          password: input.password,
          expiresAt: new Date(
            dependencies.now().getTime() + LOBBY_ABANDON_TTL_MS,
          ),
        }),
      });
      await transaction.tournamentLobbyProvision.update({
        where: { id: input.requestId },
        data: {
          state: "COMPLETED",
          lobbyId: lobby.id,
          completedAt: dependencies.now(),
          lastError: null,
        },
      });
      return lobby;
    });
    return parseLobbyRow(row);
  } catch (error) {
    await markAmbiguous(client, input.requestId, error);
    throw error;
  }
}
