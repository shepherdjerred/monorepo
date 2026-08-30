import { GlitterEvidenceError } from "./glitter-context-refresh-evidence-error.ts";

export const SYNTHESIS_INPUT_BYTE_LIMIT = 600_000;
export const MINIMUM_DIRECT_SYNTHESIS_MESSAGES = 30;

export class SynthesisInputTooLargeError extends GlitterEvidenceError {
  constructor(message: string) {
    super(message);
    this.name = "SynthesisInputTooLargeError";
  }
}

type BoundedSynthesisInput<Chunk, DirectMessage, Messages> = {
  chunks: readonly Chunk[];
  directRecentMessages: readonly DirectMessage[];
  hasRepairPrevious: boolean;
  buildMessages: (input: {
    chunks: readonly Chunk[];
    directRecentMessages: readonly DirectMessage[];
    includeRepairPrevious: boolean;
  }) => Messages;
  serializeMessages: (messages: Messages) => string;
};

/**
 * Keep the newest evidence that fits the per-call reservation. Monthly
 * summaries are reduced first, followed by the oldest direct messages down to
 * the 30 messages needed by the synthesis response contract. A repair may omit
 * its previous invalid response as a final fallback; the original card and
 * validation error remain, so the model can regenerate the complete patch.
 */
export function buildBoundedSynthesisInput<Chunk, DirectMessage, Messages>(
  input: BoundedSynthesisInput<Chunk, DirectMessage, Messages>,
): {
  chunks: readonly Chunk[];
  directRecentMessages: readonly DirectMessage[];
  includeRepairPrevious: boolean;
  messages: Messages;
  inputBytes: number;
} {
  const minimumDirectMessages = Math.min(
    MINIMUM_DIRECT_SYNTHESIS_MESSAGES,
    input.directRecentMessages.length,
  );
  const repairPreviousModes = input.hasRepairPrevious ? [true, false] : [false];
  const buildCandidate = (candidate: {
    chunks: readonly Chunk[];
    directRecentMessages: readonly DirectMessage[];
    includeRepairPrevious: boolean;
  }) => {
    const messages = input.buildMessages(candidate);
    return {
      ...candidate,
      messages,
      inputBytes: new TextEncoder().encode(input.serializeMessages(messages))
        .length,
    };
  };
  for (const includeRepairPrevious of repairPreviousModes) {
    for (
      let omittedChunks = 0;
      omittedChunks <= input.chunks.length;
      omittedChunks += 1
    ) {
      const candidate = buildCandidate({
        chunks: input.chunks.slice(omittedChunks),
        directRecentMessages: input.directRecentMessages,
        includeRepairPrevious,
      });
      if (candidate.inputBytes <= SYNTHESIS_INPUT_BYTE_LIMIT) {
        return candidate;
      }
    }
    const maximumOmittedDirectMessages =
      input.directRecentMessages.length - minimumDirectMessages;
    for (
      let omittedDirectMessages = 1;
      omittedDirectMessages <= maximumOmittedDirectMessages;
      omittedDirectMessages += 1
    ) {
      const candidate = buildCandidate({
        chunks: [],
        directRecentMessages: input.directRecentMessages.slice(
          omittedDirectMessages,
        ),
        includeRepairPrevious,
      });
      if (candidate.inputBytes <= SYNTHESIS_INPUT_BYTE_LIMIT) {
        return candidate;
      }
    }
  }
  throw new SynthesisInputTooLargeError(
    `fixed Glitter synthesis input exceeds ${String(SYNTHESIS_INPUT_BYTE_LIMIT)} bytes after removing monthly summaries, reducing direct evidence to ${String(minimumDirectMessages)} messages, and omitting the previous repair output`,
  );
}
