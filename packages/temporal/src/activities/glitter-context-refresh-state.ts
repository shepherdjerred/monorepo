import {
  GenerationStateDocumentSchema,
  type GenerationStateDocument,
  type GenerationStateEntry,
} from "@shepherdjerred/glitter-context/schema";
import type { selectStyleRefreshCandidates } from "./glitter-context-refresh-selection.ts";

export function shouldEvaluateRelationships(
  sourceSnapshotChecksum: string | null,
  latestSnapshotChecksum: string,
): boolean {
  return sourceSnapshotChecksum !== latestSnapshotChecksum;
}

export function shouldPersistRelationshipEvaluation(input: {
  evaluated: boolean;
  refreshedPeopleCount: number;
  relationshipProposalCount: number;
}): boolean {
  return (
    input.evaluated &&
    (input.refreshedPeopleCount > 0 || input.relationshipProposalCount > 0)
  );
}

/**
 * One person's evidence failing is a partial success worth shipping; every
 * eligible person failing is not. It means the run produced nothing and the
 * cause is systemic rather than one person's corpus, so it must surface as a
 * failed activity instead of an empty PR.
 */
export function shouldFailRefreshRun(input: {
  candidateCount: number;
  refreshedCount: number;
}): boolean {
  return input.candidateCount > 0 && input.refreshedCount === 0;
}

export function updateGenerationState(input: {
  state: GenerationStateDocument;
  refreshedPeople: ReadonlySet<string>;
  candidates: ReturnType<typeof selectStyleRefreshCandidates>;
  snapshotSha256: string;
  refreshedAt: string;
  relationshipsEvaluated: boolean;
}): GenerationStateDocument {
  const candidateByPerson = new Map(
    input.candidates.map((candidate) => [candidate.person.id, candidate]),
  );
  const refreshedEntryFor = (personId: string): GenerationStateEntry => {
    const candidate = candidateByPerson.get(personId);
    const lastMessage = candidate?.messages.at(-1);
    if (candidate === undefined || lastMessage === undefined) {
      throw new Error(`missing refreshed candidate state for ${personId}`);
    }
    return {
      personId,
      lastMessageId: lastMessage.messageId,
      sourceSnapshotChecksum: input.snapshotSha256,
      messageCount: candidate.totalMessageCount,
      refreshedAt: input.refreshedAt,
    };
  };
  const existingPersonIds = new Set(
    input.state.people.map((entry) => entry.personId),
  );
  const updatedExisting = input.state.people.map((entry) =>
    input.refreshedPeople.has(entry.personId)
      ? { ...entry, ...refreshedEntryFor(entry.personId) }
      : entry,
  );
  // A person can become a refresh candidate without a pre-existing state entry
  // (new Discord ID + style card). Without appending their watermark here, every
  // later weekly run would treat them as never-refreshed and regenerate their
  // card from the entire corpus. Record state for those newly refreshed people.
  const appended = [...input.refreshedPeople]
    .filter((personId) => !existingPersonIds.has(personId))
    .toSorted()
    .map((personId) => refreshedEntryFor(personId));
  return GenerationStateDocumentSchema.parse({
    ...input.state,
    relationshipSourceSnapshotChecksum: input.relationshipsEvaluated
      ? input.snapshotSha256
      : input.state.relationshipSourceSnapshotChecksum,
    relationshipRefreshedAt: input.relationshipsEvaluated
      ? input.refreshedAt
      : input.state.relationshipRefreshedAt,
    people: [...updatedExisting, ...appended],
  });
}
