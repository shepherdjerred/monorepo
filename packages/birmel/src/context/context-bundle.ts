import { z } from "zod";
import {
  CONTEXT_BUDGETS,
  ContextBundleSchema,
  ContextSourceSchema,
  DiscordIdSchema,
  type ContextBundle,
  type ContextSource,
} from "@shepherdjerred/birmel/agent-runtime/contracts.ts";

const TranscriptMessageSchema = z.object({
  id: DiscordIdSchema,
  authorName: z.string().min(1),
  isBot: z.boolean(),
  content: z.string(),
  createdAt: z.date(),
});

const RankedFragmentSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["memory", "lore"]),
  content: z.string().min(1),
  rank: z.number(),
  memoryClaimId: z.string().optional(),
});

const SessionEventSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["user", "assistant", "tool"]),
  content: z.string(),
  sequence: z.number().int().nonnegative(),
  createdAt: z.date(),
  discordMessageId: DiscordIdSchema.optional(),
});

export const ContextAssemblyInputSchema = z.object({
  systemPolicy: z.string().min(1),
  personaProjection: z.string(),
  currentMessage: TranscriptMessageSchema,
  transcript: z
    .array(TranscriptMessageSchema)
    .max(CONTEXT_BUDGETS.transcriptFetchLimit),
  transcriptFetchFailed: z.boolean().default(false),
  rankedFragments: z.array(RankedFragmentSchema).default([]),
  sessionSummary: z.string().optional(),
  sessionEvents: z.array(SessionEventSchema).default([]),
});
export type ContextAssemblyInput = z.infer<typeof ContextAssemblyInputSchema>;

function source(input: {
  id: string;
  kind: ContextSource["kind"];
  content: string;
  rank?: number;
  discordMessageId?: string;
  memoryClaimId?: string;
}): ContextSource {
  return ContextSourceSchema.parse({
    ...input,
    characterCount: input.content.length,
  });
}

function renderTranscriptMessage(
  message: z.infer<typeof TranscriptMessageSchema>,
): string {
  const author = message.isBot
    ? `${message.authorName} (assistant)`
    : message.authorName;
  return `${author}: ${message.content}`;
}

function totalFor(sources: readonly ContextSource[]): number {
  return sources.map(({ content }) => content).join("\n").length;
}

function categorySize(
  sources: readonly ContextSource[],
  kinds: ReadonlySet<ContextSource["kind"]>,
): number {
  return sources
    .filter(({ kind }) => kinds.has(kind))
    .reduce((total, item) => total + item.characterCount, 0);
}

type TranscriptCandidate = {
  source: ContextSource;
  createdAt: Date;
  sessionSequence: number | undefined;
};

function compareTranscriptCandidates(
  left: TranscriptCandidate,
  right: TranscriptCandidate,
): number {
  const timestamp = left.createdAt.getTime() - right.createdAt.getTime();
  if (timestamp !== 0) {
    return timestamp;
  }
  const sequence = (left.sessionSequence ?? -1) - (right.sessionSequence ?? -1);
  if (sequence !== 0) {
    return sequence;
  }
  return left.source.id.localeCompare(right.source.id);
}

function selectRankedFragments(
  fragments: z.infer<typeof RankedFragmentSchema>[],
): ContextSource[] {
  const selected: ContextSource[] = [];
  let used = 0;
  let selectedMemoryClaims = 0;
  for (const fragment of fragments.toSorted(
    (left, right) => right.rank - left.rank || left.id.localeCompare(right.id),
  )) {
    if (
      fragment.kind === "memory" &&
      selectedMemoryClaims >= CONTEXT_BUDGETS.maximumClaims
    ) {
      continue;
    }
    if (used + fragment.content.length > CONTEXT_BUDGETS.loreAndMemory) {
      continue;
    }
    selected.push(
      source({
        id: fragment.id,
        kind: fragment.kind,
        content: fragment.content,
        rank: fragment.rank,
        ...(fragment.memoryClaimId == null
          ? {}
          : { memoryClaimId: fragment.memoryClaimId }),
      }),
    );
    used += fragment.content.length;
    if (fragment.kind === "memory") {
      selectedMemoryClaims += 1;
    }
  }
  return selected;
}

function selectTranscriptSources(
  input: z.infer<typeof ContextAssemblyInputSchema>,
): ContextSource[] {
  const current = source({
    id: `discord:${input.currentMessage.id}`,
    kind: "current-message",
    content: renderTranscriptMessage(input.currentMessage),
    rank: Number.MAX_SAFE_INTEGER,
    discordMessageId: input.currentMessage.id,
  });
  if (current.characterCount > CONTEXT_BUDGETS.transcript) {
    throw new Error("Current Discord message exceeds the transcript budget");
  }

  const summaryCapacity = Math.min(
    CONTEXT_BUDGETS.sessionSummary,
    CONTEXT_BUDGETS.transcript - current.characterCount,
  );
  const boundedSummary = input.sessionSummary?.slice(0, summaryCapacity);
  const summary =
    boundedSummary == null || boundedSummary.length === 0
      ? undefined
      : source({
          id: "session-summary",
          kind: "session-summary",
          content: boundedSummary,
          rank: -1,
        });

  const byDiscordId = new Map<string, TranscriptCandidate>();
  const withoutDiscordId: TranscriptCandidate[] = [];

  for (const event of input.sessionEvents.toSorted(
    (left, right) => right.sequence - left.sequence,
  )) {
    const candidate = {
      source: source({
        id: `session-event:${event.id}`,
        kind: "session-event",
        content: `${event.role}: ${event.content}`,
        rank: event.createdAt.getTime(),
        ...(event.discordMessageId == null
          ? {}
          : { discordMessageId: event.discordMessageId }),
      }),
      createdAt: event.createdAt,
      sessionSequence: event.sequence,
    };
    if (event.discordMessageId == null) {
      withoutDiscordId.push(candidate);
    } else if (
      event.discordMessageId !== input.currentMessage.id &&
      !byDiscordId.has(event.discordMessageId)
    ) {
      byDiscordId.set(event.discordMessageId, candidate);
    }
  }

  for (const message of input.transcript.toSorted(
    (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
  )) {
    if (message.id === input.currentMessage.id || byDiscordId.has(message.id)) {
      continue;
    }
    byDiscordId.set(message.id, {
      source: source({
        id: `discord:${message.id}`,
        kind: "transcript",
        content: renderTranscriptMessage(message),
        rank: message.createdAt.getTime(),
        discordMessageId: message.id,
      }),
      createdAt: message.createdAt,
      sessionSequence: undefined,
    });
  }

  const candidates = [...byDiscordId.values(), ...withoutDiscordId].toSorted(
    (left, right) => compareTranscriptCandidates(right, left),
  );
  const selectedCandidates: TranscriptCandidate[] = [];
  let used = current.characterCount + (summary?.characterCount ?? 0);

  for (const candidate of candidates) {
    if (used + candidate.source.characterCount > CONTEXT_BUDGETS.transcript) {
      continue;
    }
    selectedCandidates.push(candidate);
    used += candidate.source.characterCount;
  }

  const selected = selectedCandidates
    .toSorted(compareTranscriptCandidates)
    .map((candidate) => candidate.source);
  selected.push(current);
  if (summary != null) {
    selected.unshift(summary);
  }
  return selected;
}

function trimToTotalBudget(sources: ContextSource[]): ContextSource[] {
  const selected = [...sources];
  while (totalFor(selected) > CONTEXT_BUDGETS.total) {
    const oldestTranscriptIndex = selected.findIndex(
      ({ kind }) => kind === "transcript" || kind === "session-event",
    );
    if (oldestTranscriptIndex !== -1) {
      selected.splice(oldestTranscriptIndex, 1);
      continue;
    }

    let lowestFragmentIndex = -1;
    for (let index = 0; index < selected.length; index += 1) {
      const item = selected[index];
      if (item == null || (item.kind !== "memory" && item.kind !== "lore")) {
        continue;
      }
      const currentLowest = selected[lowestFragmentIndex];
      if (
        currentLowest == null ||
        item.rank < currentLowest.rank ||
        (item.rank === currentLowest.rank && item.id > currentLowest.id)
      ) {
        lowestFragmentIndex = index;
      }
    }
    if (lowestFragmentIndex >= 0) {
      selected.splice(lowestFragmentIndex, 1);
      continue;
    }
    throw new Error(
      "Mandatory context sources exceed the total context budget",
    );
  }
  return selected;
}

export function assembleContextBundle(rawInput: unknown): ContextBundle {
  const input = ContextAssemblyInputSchema.parse(rawInput);
  if (input.systemPolicy.length > CONTEXT_BUDGETS.coreInstructions) {
    throw new Error("System policy exceeds the core instruction budget");
  }
  if (input.personaProjection.length > CONTEXT_BUDGETS.persona) {
    throw new Error("Persona projection exceeds the persona budget");
  }

  const sources = trimToTotalBudget([
    source({
      id: "system-policy",
      kind: "system-policy",
      content: input.systemPolicy,
      rank: Number.MAX_SAFE_INTEGER,
    }),
    ...(input.personaProjection.length === 0
      ? []
      : [
          source({
            id: "persona",
            kind: "persona",
            content: input.personaProjection,
            rank: Number.MAX_SAFE_INTEGER,
          }),
        ]),
    ...selectRankedFragments(input.rankedFragments),
    ...selectTranscriptSources(input),
  ]);

  const discordMessageIds = sources.flatMap(({ discordMessageId }) =>
    discordMessageId == null ? [] : [discordMessageId],
  );
  if (new Set(discordMessageIds).size !== discordMessageIds.length) {
    throw new Error("Context bundle contains a duplicate Discord message ID");
  }

  const coreKinds = new Set<ContextSource["kind"]>(["system-policy"]);
  const personaKinds = new Set<ContextSource["kind"]>(["persona"]);
  const memoryKinds = new Set<ContextSource["kind"]>(["memory", "lore"]);
  const transcriptKinds = new Set<ContextSource["kind"]>([
    "session-summary",
    "session-event",
    "transcript",
    "current-message",
  ]);
  const assembled = sources.map(({ content }) => content).join("\n");

  return ContextBundleSchema.parse({
    version: 1,
    sources,
    assembled,
    sizes: {
      coreInstructions: categorySize(sources, coreKinds),
      persona: categorySize(sources, personaKinds),
      loreAndMemory: categorySize(sources, memoryKinds),
      transcript: categorySize(sources, transcriptKinds),
      total: assembled.length,
    },
    selectedMemoryClaimIds: sources.flatMap(({ memoryClaimId }) =>
      memoryClaimId == null ? [] : [memoryClaimId],
    ),
    transcriptFetchFailed: input.transcriptFetchFailed,
  });
}
