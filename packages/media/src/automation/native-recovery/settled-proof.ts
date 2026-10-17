import {
  SettledNativeEvidenceSchema,
  type NativePublishedScope,
} from "#shared/native-recovery/lifecycle.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import {
  verifyTerminalJournal,
  verifyInstallationJournal,
  terminalFileEvidence,
  type ProofInput,
} from "./terminal-proof.ts";

export function settledJournals(scope: NativePublishedScope) {
  return (
    scope.schemaVersion === 2 ? (scope.settledQuarantines ?? []) : []
  ).flatMap((item) => [
    ...item.participants.map((participant) => ({
      operationId: `native-restore-${item.continuationId}-${participant.quarantineId}`,
      kind: "restore" as const,
      source: participant.quarantinePath,
      target: participant.canonicalPath,
      sha256: participant.checksum,
      previousSha256: null,
    })),
    ...item.replacementJournals,
    ...(item.installations ?? []).flatMap(
      (installation) => installation.journals,
    ),
  ]);
}
export async function settledEvidence(input: ProofInput) {
  const result = [];
  for (const item of input.scope.schemaVersion === 2
    ? (input.scope.settledQuarantines ?? [])
    : []) {
    const journals = [
      ...settledJournals(input.scope).filter((journal) =>
        journal.operationId.startsWith(
          `native-restore-${item.continuationId}-`,
        ),
      ),
      ...item.replacementJournals,
    ];
    const hashes = [];
    for (const journal of journals)
      hashes.push(await verifyTerminalJournal(input, journal));
    for (const installation of item.installations ?? [])
      hashes.push(
        await verifyInstallationJournal(input, installation.journals),
      );
    const files = [];
    for (const participant of item.participants)
      files.push(
        await terminalFileEvidence(input, {
          canonicalPath: participant.quarantinePath,
          expectedChecksum: null,
        }),
      );
    for (const file of item.replacementFiles)
      files.push(await terminalFileEvidence(input, file));
    result.push(
      SettledNativeEvidenceSchema.parse({
        continuationId: item.continuationId,
        journalDigest: snapshotHash(hashes),
        files,
      }),
    );
  }
  return result;
}
