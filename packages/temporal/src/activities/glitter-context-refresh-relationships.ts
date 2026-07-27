import {
  RelationshipsDocumentSchema,
  type Person,
  type RelationshipEvent,
  type RelationshipsDocument,
} from "@shepherdjerred/glitter-context/schema";
import type { CurrentMessage } from "#shared/glitter-corpus.ts";
import { sha256 } from "#shared/glitter-corpus-projection.ts";
import type { RelationshipProposal } from "./glitter-context-refresh-generate.ts";
import { isSafeStyleSample } from "./glitter-context-refresh-selection.ts";

const MAX_RELATIONSHIP_EVIDENCE = 500;

function compareSnowflakes(first: string, second: string): number {
  const firstValue = BigInt(first);
  const secondValue = BigInt(second);
  return firstValue < secondValue ? -1 : firstValue > secondValue ? 1 : 0;
}

function unorderedPair(first: string, second: string): string {
  return [first, second].toSorted().join(":");
}

/**
 * Endpoint list for a relationship, direction-aware. Undirected relationships
 * are order-independent (`A ↔ B` === `B ↔ A`), but directed `source-to-target`
 * relationships must preserve endpoint order so that reversing the direction
 * (`A → B` becoming `B → A`) is recognized as a distinct, superseding event.
 */
function endpointList(
  sourceId: string,
  targetId: string,
  direction: RelationshipEvent["direction"],
): string[] {
  return direction === "undirected"
    ? [sourceId, targetId].toSorted()
    : [sourceId, targetId];
}

function endpointKey(
  sourceId: string,
  targetId: string,
  direction: RelationshipEvent["direction"],
): string {
  return endpointList(sourceId, targetId, direction).join(":");
}

export function selectRelationshipEvidence(input: {
  people: readonly Person[];
  messages: readonly CurrentMessage[];
}): { personId: string; message: CurrentMessage }[] {
  const personByDiscordId = new Map<string, string>();
  for (const person of input.people) {
    for (const discordId of person.discordUserIds) {
      personByDiscordId.set(discordId, person.id);
    }
  }
  return input.messages
    .flatMap((message) => {
      const personId = personByDiscordId.get(message.author.id);
      return personId === undefined || !isSafeStyleSample(message)
        ? []
        : [{ personId, message }];
    })
    .toSorted((first, second) =>
      compareSnowflakes(first.message.messageId, second.message.messageId),
    )
    .slice(-MAX_RELATIONSHIP_EVIDENCE);
}

function proposalId(proposal: RelationshipProposal): string {
  const pair = endpointList(
    proposal.sourceId,
    proposal.targetId,
    proposal.direction,
  );
  const digest = sha256(
    new TextEncoder().encode(
      JSON.stringify({
        pair,
        kind: proposal.kind,
        label: proposal.label,
        direction: proposal.direction,
        evidenceMessageIds: proposal.evidenceMessageIds.toSorted(),
      }),
    ),
  ).slice(0, 12);
  return `${pair.join("-")}-${proposal.kind}-${digest}`;
}

function isSameRelationship(
  event: RelationshipEvent,
  proposal: RelationshipProposal,
): boolean {
  return (
    event.direction === proposal.direction &&
    endpointKey(event.sourceId, event.targetId, event.direction) ===
      endpointKey(proposal.sourceId, proposal.targetId, proposal.direction) &&
    event.kind === proposal.kind &&
    event.label.trim().toLocaleLowerCase() ===
      proposal.label.trim().toLocaleLowerCase()
  );
}

export function applyRelationshipProposals(input: {
  document: RelationshipsDocument;
  proposals: readonly RelationshipProposal[];
  people: readonly Person[];
  evidence: readonly { personId: string; message: CurrentMessage }[];
  snapshotSha256: string;
  recordedAt: string;
}): { document: RelationshipsDocument; appliedCount: number } {
  const peopleIds = new Set(input.people.map((person) => person.id));
  const evidenceById = new Map(
    input.evidence.map((entry) => [entry.message.messageId, entry]),
  );
  const events = input.document.events.map((event) => ({ ...event }));
  const proposalKeys = new Set<string>();
  let appliedCount = 0;

  for (const proposal of input.proposals) {
    if (
      proposal.sourceId === proposal.targetId ||
      !peopleIds.has(proposal.sourceId) ||
      !peopleIds.has(proposal.targetId)
    ) {
      throw new Error("relationship proposal references invalid people");
    }
    const proposalKey = `${unorderedPair(
      proposal.sourceId,
      proposal.targetId,
    )}:${proposal.kind}`;
    if (proposalKeys.has(proposalKey)) {
      throw new Error(`duplicate relationship proposal for ${proposalKey}`);
    }
    proposalKeys.add(proposalKey);

    const evidenceIds = new Set(proposal.evidenceMessageIds);
    if (evidenceIds.size !== proposal.evidenceMessageIds.length) {
      throw new Error(`relationship proposal ${proposalKey} repeats evidence`);
    }
    const evidenceAuthors = new Set<string>();
    for (const messageId of evidenceIds) {
      const evidence = evidenceById.get(messageId);
      if (evidence === undefined) {
        throw new Error(
          `relationship proposal ${proposalKey} cites unavailable message ${messageId}`,
        );
      }
      evidenceAuthors.add(evidence.personId);
    }
    if (
      !evidenceAuthors.has(proposal.sourceId) &&
      !evidenceAuthors.has(proposal.targetId)
    ) {
      throw new Error(
        `relationship proposal ${proposalKey} has no first-party evidence`,
      );
    }

    const currentSameKind = events.filter(
      (event) =>
        event.status === "current" &&
        event.kind === proposal.kind &&
        unorderedPair(event.sourceId, event.targetId) ===
          unorderedPair(proposal.sourceId, proposal.targetId),
    );
    if (currentSameKind.some((event) => isSameRelationship(event, proposal))) {
      continue;
    }
    for (const event of currentSameKind) {
      event.status = "historical";
    }
    const superseded = currentSameKind.map((event) => event.id).toSorted()[0];
    const eventId = proposalId(proposal);
    if (events.some((event) => event.id === eventId)) {
      continue;
    }
    events.push({
      id: eventId,
      sourceId: proposal.sourceId,
      targetId: proposal.targetId,
      kind: proposal.kind,
      label: proposal.label,
      direction: proposal.direction,
      status: "current",
      effectiveAt: proposal.effectiveAt,
      recordedAt: input.recordedAt,
      supersedesEventId: superseded ?? null,
      provenance: [
        {
          kind: "corpus-evidence",
          reference: `verified-snapshot:${input.snapshotSha256}`,
          messageIds: [...evidenceIds].toSorted(compareSnowflakes),
        },
      ],
    });
    appliedCount += 1;
  }
  return {
    document: RelationshipsDocumentSchema.parse({
      ...input.document,
      events,
    }),
    appliedCount,
  };
}
