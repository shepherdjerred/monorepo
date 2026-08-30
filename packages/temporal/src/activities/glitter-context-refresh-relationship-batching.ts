import {
  type GenerationStateDocument,
  type PeopleDocument,
  type RelationshipsDocument,
} from "@shepherdjerred/glitter-context/schema";
import type { CurrentMessage } from "#shared/glitter-corpus.ts";
import { buildBoundedRelationshipInput } from "./glitter-context-refresh-requests.ts";
import { selectRelationshipEvidenceBatch } from "./glitter-context-refresh-relationships.ts";

type RelationshipEvidence = ReturnType<
  typeof selectRelationshipEvidenceBatch
>["evidence"][number];

export type PreparedRelationshipEvaluation = {
  evaluated: boolean;
  complete: boolean;
  progressed: boolean;
  cursor: string | null;
  evidence: readonly RelationshipEvidence[];
  generationInput: {
    people: { id: string; displayName: string }[];
    currentRelationships: RelationshipsDocument["events"];
    evidence: readonly RelationshipEvidence[];
  };
};

export function prepareRelationshipEvaluation(input: {
  state: GenerationStateDocument;
  people: PeopleDocument;
  relationships: RelationshipsDocument;
  messages: readonly CurrentMessage[];
  snapshotSha256: string;
}): PreparedRelationshipEvaluation {
  const evaluated =
    input.state.relationshipSourceSnapshotChecksum !== input.snapshotSha256;
  const people = input.people.people.map((person) => ({
    id: person.id,
    displayName: person.displayName,
  }));
  const currentRelationships = input.relationships.events.filter(
    (event) => event.status === "current",
  );
  if (!evaluated) {
    return {
      evaluated: false,
      complete: false,
      progressed: false,
      cursor: input.state.relationshipEvaluationCursor ?? null,
      evidence: [],
      generationInput: { people, currentRelationships, evidence: [] },
    };
  }
  const batch = selectRelationshipEvidenceBatch({
    people: input.people.people,
    messages: input.messages,
    snapshotSha256: input.snapshotSha256,
    evaluationSnapshotChecksum:
      input.state.relationshipEvaluationSnapshotChecksum,
    evaluationCursor: input.state.relationshipEvaluationCursor,
  });
  const bounded = buildBoundedRelationshipInput({
    people,
    currentRelationships,
    evidence: batch.evidence,
  });
  const evidence = bounded.evidence;
  const complete = batch.complete || evidence.length === batch.evidence.length;
  return {
    evaluated,
    complete,
    progressed: complete || evidence.length > 0,
    cursor:
      evidence.at(-1)?.message.messageId ??
      input.state.relationshipEvaluationCursor ??
      null,
    evidence,
    generationInput: { people, currentRelationships, evidence },
  };
}
