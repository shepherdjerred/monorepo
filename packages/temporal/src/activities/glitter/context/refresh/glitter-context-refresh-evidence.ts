export function requireKnownEvidence(
  messageIds: readonly string[],
  knownIds: ReadonlySet<string>,
  description: string,
): void {
  const unknown = messageIds.filter((messageId) => !knownIds.has(messageId));
  if (unknown.length > 0) {
    throw new Error(
      `${description} cites unknown message IDs: ${unknown.join(", ")}`,
    );
  }
}
