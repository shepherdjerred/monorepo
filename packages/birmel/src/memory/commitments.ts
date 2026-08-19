import { normalizeMemoryText } from "@shepherdjerred/birmel/memory/serialization.ts";

const COMMITMENT_LANGUAGE =
  /\b(?:i will|i'll|i’ll|i promise|i commit|i shall|we will|we'll|we’ll|count on me)\b/u;

export function buildGroundedCommitment(options: {
  scope: "guild" | "persona" | "user";
  targetUserId: string | null;
  currentUserId: string;
  currentUserMessage: string;
  assistantMessage: string;
  commitment: string;
  topic: string;
}): { subject: string; predicate: string; value: string } {
  const normalizedCommitment = normalizeMemoryText(options.commitment);
  const normalizedTopic = normalizeMemoryText(options.topic);
  const normalizedAssistant = normalizeMemoryText(options.assistantMessage);
  if (
    normalizedCommitment.length < 8 ||
    !normalizedAssistant.includes(normalizedCommitment) ||
    !COMMITMENT_LANGUAGE.test(normalizedCommitment)
  ) {
    throw new Error(
      "Commitment must quote explicit commitment language from the delivered reply",
    );
  }
  if (
    normalizedTopic.length < 4 ||
    !normalizedCommitment.includes(normalizedTopic)
  ) {
    throw new Error(
      "Commitment topic must be a stable excerpt of the commitment",
    );
  }
  if (options.scope === "user") {
    const targetUserId = options.targetUserId;
    if (targetUserId === null) {
      throw new Error("User-scoped commitment requires a target user");
    }
    if (
      targetUserId !== options.currentUserId &&
      !normalizeMemoryText(options.currentUserMessage).includes(targetUserId)
    ) {
      throw new Error("User-scoped commitment has an ungrounded target user");
    }
  }
  return {
    subject: `Birmel commitment:${normalizedTopic}`,
    predicate: "commitment",
    value: options.commitment.trim(),
  };
}
