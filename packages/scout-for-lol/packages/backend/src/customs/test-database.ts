import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { deleteIfExists } from "#src/testing/test-database.ts";

export async function clearCustomsTestData(
  client: ExtendedPrismaClient,
): Promise<void> {
  await deleteIfExists(() => client.customAuditEvent.deleteMany());
  await deleteIfExists(() => client.customGameParticipant.deleteMany());
  await deleteIfExists(() => client.customGame.deleteMany());
  await deleteIfExists(() => client.customNightParticipant.deleteMany());
  await deleteIfExists(() => client.customNightCohost.deleteMany());
  await deleteIfExists(() => client.customActiveNight.deleteMany());
  await deleteIfExists(() => client.customNight.deleteMany());
  await deleteIfExists(() => client.customConsent.deleteMany());
  await deleteIfExists(() => client.tournamentLobbyProvision.deleteMany());
  await deleteIfExists(() => client.tournamentLobby.deleteMany());
}
