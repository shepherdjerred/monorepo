import type {
  CustomGameParticipant,
  DiscordAccountId,
  LeaguePuuid,
} from "@scout-for-lol/data";
import type { Db } from "#src/database/index.ts";
import {
  CustomOperationPayloadSchema,
  CustomOperationProgressSchema,
} from "#src/customs/operations/contracts.ts";

/** Terminal operation snapshots follow the same erasure boundary as Customs history. */
export async function anonymizeCustomOperationSnapshots(
  db: Db,
  input: {
    nightIds: string[];
    original: DiscordAccountId;
    pseudonym: DiscordAccountId;
    playerId: number;
    accountId: number;
    puuid: LeaguePuuid;
  },
): Promise<void> {
  const operations = await db.customNightOperation.findMany({
    where: { nightId: { in: input.nightIds } },
  });
  const replaceGameParticipant = (
    participant: CustomGameParticipant,
  ): CustomGameParticipant =>
    participant.discordId === input.original
      ? {
          ...participant,
          discordId: input.pseudonym,
          displayName: "Anonymized player",
          playerId: input.playerId,
          playerAlias: "Anonymized player",
          accountId: input.accountId,
          puuid: input.puuid,
          riotGameName: null,
          riotTagLine: null,
        }
      : participant;
  for (const operation of operations) {
    if (!["completed", "failed"].includes(operation.state))
      throw new Error("Cannot anonymize while Customs operations are pending");
    const payload = CustomOperationPayloadSchema.parse(
      JSON.parse(operation.payload),
    );
    const progress = CustomOperationProgressSchema.parse(
      JSON.parse(operation.progress),
    );
    const snapshot = payload.snapshot;
    if (snapshot.hostDiscordId === input.original)
      snapshot.hostDiscordId = input.pseudonym;
    snapshot.cohostDiscordIds = snapshot.cohostDiscordIds.map((id) =>
      id === input.original ? input.pseudonym : id,
    );
    snapshot.participants = snapshot.participants.map((participant) =>
      participant.discordId === input.original
        ? {
            ...participant,
            discordId: input.pseudonym,
            displayName: "Anonymized player",
            avatarUrl: null,
            playerId: null,
            playerAlias: null,
            accounts: [],
            selectedAccountId: null,
          }
        : participant,
    );
    if (snapshot.currentGame !== null)
      snapshot.currentGame.participants = snapshot.currentGame.participants.map(
        (participant) => replaceGameParticipant(participant),
      );
    if (payload.nextGame !== undefined)
      payload.nextGame.participants = payload.nextGame.participants.map(
        (participant) => replaceGameParticipant(participant),
      );
    progress.moved = progress.moved.map((id) =>
      id === input.original ? input.pseudonym : id,
    );
    await db.customNightOperation.update({
      where: { id: operation.id },
      data: {
        payload: JSON.stringify(CustomOperationPayloadSchema.parse(payload)),
        progress: JSON.stringify(progress),
        ...(operation.actorDiscordId === input.original
          ? { actorDiscordId: input.pseudonym }
          : {}),
      },
    });
  }
}
