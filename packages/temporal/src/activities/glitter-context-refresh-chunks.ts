import type { CurrentMessage } from "#shared/glitter-corpus.ts";

export const STYLE_EVIDENCE_CHUNK_SIZE = 250;

export type StyleEvidenceChunk = {
  key: string;
  month: string;
  ordinal: number;
  messages: CurrentMessage[];
};

function compareSnowflakes(
  first: CurrentMessage,
  second: CurrentMessage,
): number {
  const firstId = BigInt(first.messageId);
  const secondId = BigInt(second.messageId);
  return firstId < secondId ? -1 : firstId > secondId ? 1 : 0;
}

function utcMonth(timestamp: string): string {
  return new Date(timestamp).toISOString().slice(0, 7);
}

export function buildStyleEvidenceChunks(
  messages: readonly CurrentMessage[],
): StyleEvidenceChunk[] {
  const messagesByMonth = new Map<string, CurrentMessage[]>();
  for (const message of messages.toSorted(compareSnowflakes)) {
    const month = utcMonth(message.timestamp);
    const existing = messagesByMonth.get(month) ?? [];
    existing.push(message);
    messagesByMonth.set(month, existing);
  }

  const chunks: StyleEvidenceChunk[] = [];
  for (const month of [...messagesByMonth.keys()].toSorted()) {
    const monthMessages = messagesByMonth.get(month);
    if (monthMessages === undefined) {
      throw new Error(`missing Glitter style evidence month ${month}`);
    }
    for (
      let offset = 0;
      offset < monthMessages.length;
      offset += STYLE_EVIDENCE_CHUNK_SIZE
    ) {
      const ordinal = Math.floor(offset / STYLE_EVIDENCE_CHUNK_SIZE);
      chunks.push({
        key: `${month}-${String(ordinal).padStart(4, "0")}`,
        month,
        ordinal,
        messages: monthMessages.slice(
          offset,
          offset + STYLE_EVIDENCE_CHUNK_SIZE,
        ),
      });
    }
  }
  return chunks;
}
