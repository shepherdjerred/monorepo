import { compareSnowflakes } from "#shared/glitter-corpus-projection.ts";

export function assertDiscordPageOrder(input: {
  messageIds: readonly string[];
  direction: "backward" | "forward" | "daily-overlap";
  objectKey: string;
}): void {
  const expectedOrder =
    input.direction === "forward" ? "oldest-to-newest" : "newest-to-oldest";
  for (const [index, messageId] of input.messageIds.entries()) {
    const next = input.messageIds[index + 1];
    if (next === undefined) {
      continue;
    }
    const comparison = compareSnowflakes(messageId, next);
    const valid =
      input.direction === "forward" ? comparison < 0 : comparison > 0;
    if (!valid) {
      throw new Error(
        `raw Discord page ${input.objectKey} is not strictly ${expectedOrder}`,
      );
    }
  }
}
