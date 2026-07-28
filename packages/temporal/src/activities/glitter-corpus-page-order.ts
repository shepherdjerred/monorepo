import { compareSnowflakes } from "#shared/glitter-corpus-projection.ts";

export function assertDiscordPageOrder(input: {
  messageIds: readonly string[];
  direction: "backward" | "forward" | "daily-overlap";
  objectKey: string;
}): void {
  for (const [index, messageId] of input.messageIds.entries()) {
    const next = input.messageIds[index + 1];
    if (next === undefined) {
      continue;
    }
    const comparison = compareSnowflakes(messageId, next);
    if (comparison <= 0) {
      throw new Error(
        `raw Discord ${input.direction} page ${input.objectKey} is not strictly newest-to-oldest`,
      );
    }
  }
}

export function nextTraversalCursor(input: {
  direction: "backward" | "forward";
  messageIds: readonly string[];
  previousCursor: string | undefined;
}): string | undefined {
  const cursor =
    input.direction === "forward"
      ? input.messageIds[0]
      : input.messageIds.at(-1);
  return cursor ?? input.previousCursor;
}
