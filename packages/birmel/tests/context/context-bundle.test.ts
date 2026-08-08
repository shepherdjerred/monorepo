import { describe, expect, test } from "bun:test";
import {
  CONTEXT_BUDGETS,
  type ContextBundle,
} from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import {
  assembleContextBundle,
  type ContextAssemblyInput,
} from "@shepherdjerred/birmel/context/context-bundle.ts";

type TranscriptMessage = ContextAssemblyInput["currentMessage"];

const CURRENT_MESSAGE_ID = "9000";

function transcriptMessage(input: {
  id: string;
  createdAt?: Date;
  content?: string;
  authorName?: string;
  isBot?: boolean;
}): TranscriptMessage {
  return {
    id: input.id,
    authorName: input.authorName ?? "u",
    isBot: input.isBot ?? false,
    content: input.content ?? `message-${input.id}`,
    createdAt: input.createdAt ?? new Date("2026-08-08T12:00:00.000Z"),
  };
}

function messageWithRenderedLength(input: {
  id: string;
  renderedLength: number;
  createdAt?: Date;
}): TranscriptMessage {
  const prefix = "u: ";
  if (input.renderedLength < prefix.length) {
    throw new Error("Rendered message length must include the author prefix");
  }
  return transcriptMessage({
    id: input.id,
    ...(input.createdAt == null ? {} : { createdAt: input.createdAt }),
    content: "x".repeat(input.renderedLength - prefix.length),
  });
}

function assemblyInput(
  overrides: Partial<ContextAssemblyInput> = {},
): ContextAssemblyInput {
  return {
    systemPolicy: "system-policy",
    personaProjection: "persona-projection",
    currentMessage: transcriptMessage({ id: CURRENT_MESSAGE_ID }),
    transcript: [],
    transcriptFetchFailed: false,
    rankedFragments: [],
    sessionEvents: [],
    ...overrides,
  };
}

function sourceIds(bundle: ContextBundle): string[] {
  return bundle.sources.map(({ id }) => id);
}

function discordMessageIds(bundle: ContextBundle): string[] {
  return bundle.sources.flatMap(({ discordMessageId }) =>
    discordMessageId == null ? [] : [discordMessageId],
  );
}

describe("assembleContextBundle ordering and source representation", () => {
  test("orders categories and records deterministically", () => {
    const bundle = assembleContextBundle(
      assemblyInput({
        rankedFragments: [
          {
            id: "memory-b",
            kind: "memory",
            content: "memory-b",
            rank: 20,
            memoryClaimId: "claim-b",
          },
          {
            id: "lore-high",
            kind: "lore",
            content: "lore-high",
            rank: 30,
          },
          {
            id: "memory-a",
            kind: "memory",
            content: "memory-a",
            rank: 20,
            memoryClaimId: "claim-a",
          },
        ],
        sessionSummary: "summary",
        sessionEvents: [
          {
            id: "event-2",
            role: "assistant",
            content: "event two",
            sequence: 2,
          },
          {
            id: "event-1",
            role: "user",
            content: "event one",
            sequence: 1,
          },
        ],
        transcript: [
          transcriptMessage({
            id: "2002",
            createdAt: new Date("2026-08-08T11:02:00.000Z"),
          }),
          transcriptMessage({
            id: "2001",
            createdAt: new Date("2026-08-08T11:01:00.000Z"),
          }),
        ],
      }),
    );

    expect(sourceIds(bundle)).toEqual([
      "system-policy",
      "persona",
      "lore-high",
      "memory-a",
      "memory-b",
      "session-summary",
      "session-event:event-1",
      "session-event:event-2",
      "discord:2001",
      "discord:2002",
      `discord:${CURRENT_MESSAGE_ID}`,
    ]);
    expect(bundle.assembled).toBe(
      bundle.sources.map(({ content }) => content).join("\n"),
    );
  });

  test("produces the same bundle for equivalent inputs in different orders", () => {
    const fragments = [
      {
        id: "memory-a",
        kind: "memory" as const,
        content: "memory-a",
        rank: 10,
        memoryClaimId: "claim-a",
      },
      {
        id: "lore-a",
        kind: "lore" as const,
        content: "lore-a",
        rank: 10,
      },
    ];
    const transcript = [
      transcriptMessage({
        id: "3001",
        createdAt: new Date("2026-08-08T10:00:00.000Z"),
      }),
      transcriptMessage({
        id: "3002",
        createdAt: new Date("2026-08-08T10:00:00.000Z"),
      }),
    ];
    const sessionEvents = [
      { id: "event-b", role: "assistant" as const, content: "b", sequence: 1 },
      { id: "event-a", role: "user" as const, content: "a", sequence: 1 },
    ];

    const first = assembleContextBundle(
      assemblyInput({ rankedFragments: fragments, transcript, sessionEvents }),
    );
    const second = assembleContextBundle(
      assemblyInput({
        rankedFragments: fragments.toReversed(),
        transcript: transcript.toReversed(),
        sessionEvents: sessionEvents.toReversed(),
      }),
    );

    expect(second).toEqual(first);
  });

  test("represents optional context scopes only when supplied", () => {
    const minimal = assembleContextBundle(
      assemblyInput({ personaProjection: "" }),
    );
    expect(minimal.sources.map(({ kind }) => kind)).toEqual([
      "system-policy",
      "current-message",
    ]);

    const complete = assembleContextBundle(
      assemblyInput({
        rankedFragments: [
          { id: "memory", kind: "memory", content: "memory", rank: 2 },
          { id: "lore", kind: "lore", content: "lore", rank: 1 },
        ],
        sessionSummary: "session summary",
        sessionEvents: [
          { id: "event", role: "tool", content: "tool result", sequence: 1 },
        ],
        transcript: [transcriptMessage({ id: "4001" })],
      }),
    );

    expect(new Set(complete.sources.map(({ kind }) => kind))).toEqual(
      new Set([
        "system-policy",
        "persona",
        "memory",
        "lore",
        "session-summary",
        "session-event",
        "transcript",
        "current-message",
      ]),
    );
  });
});

describe("assembleContextBundle budgets", () => {
  test("accepts the core-instruction boundary and rejects one character over", () => {
    const atLimit = assembleContextBundle(
      assemblyInput({
        systemPolicy: "s".repeat(CONTEXT_BUDGETS.coreInstructions),
      }),
    );
    expect(atLimit.sizes.coreInstructions).toBe(
      CONTEXT_BUDGETS.coreInstructions,
    );

    expect(() =>
      assembleContextBundle(
        assemblyInput({
          systemPolicy: "s".repeat(CONTEXT_BUDGETS.coreInstructions + 1),
        }),
      ),
    ).toThrow("System policy exceeds the core instruction budget");
  });

  test("accepts the persona boundary and rejects one character over", () => {
    const atLimit = assembleContextBundle(
      assemblyInput({ personaProjection: "p".repeat(CONTEXT_BUDGETS.persona) }),
    );
    expect(atLimit.sizes.persona).toBe(CONTEXT_BUDGETS.persona);

    expect(() =>
      assembleContextBundle(
        assemblyInput({
          personaProjection: "p".repeat(CONTEXT_BUDGETS.persona + 1),
        }),
      ),
    ).toThrow("Persona projection exceeds the persona budget");
  });

  test("selects ranked lore and memory fragments within the shared budget", () => {
    const bundle = assembleContextBundle(
      assemblyInput({
        rankedFragments: [
          {
            id: "high",
            kind: "memory",
            content: "h".repeat(7000),
            rank: 3,
            memoryClaimId: "claim-high",
          },
          {
            id: "does-not-fit",
            kind: "lore",
            content: "n".repeat(1500),
            rank: 2,
          },
          {
            id: "fills-budget",
            kind: "lore",
            content: "f".repeat(1000),
            rank: 1,
          },
        ],
      }),
    );

    expect(bundle.sizes.loreAndMemory).toBe(CONTEXT_BUDGETS.loreAndMemory);
    expect(sourceIds(bundle)).toContain("high");
    expect(sourceIds(bundle)).toContain("fills-budget");
    expect(sourceIds(bundle)).not.toContain("does-not-fit");
  });

  test("keeps the newest transcript messages that fit the transcript budget", () => {
    const bundle = assembleContextBundle(
      assemblyInput({
        currentMessage: messageWithRenderedLength({
          id: CURRENT_MESSAGE_ID,
          renderedLength: 8000,
        }),
        transcript: [
          messageWithRenderedLength({
            id: "5001",
            renderedLength: 6000,
            createdAt: new Date("2026-08-08T10:01:00.000Z"),
          }),
          messageWithRenderedLength({
            id: "5002",
            renderedLength: 6000,
            createdAt: new Date("2026-08-08T10:02:00.000Z"),
          }),
          messageWithRenderedLength({
            id: "5003",
            renderedLength: 6000,
            createdAt: new Date("2026-08-08T10:03:00.000Z"),
          }),
        ],
      }),
    );

    expect(bundle.sizes.transcript).toBe(CONTEXT_BUDGETS.transcript);
    expect(sourceIds(bundle)).not.toContain("discord:5001");
    expect(sourceIds(bundle)).toContain("discord:5002");
    expect(sourceIds(bundle)).toContain("discord:5003");
    expect(sourceIds(bundle).slice(-3)).toEqual([
      "discord:5002",
      "discord:5003",
      `discord:${CURRENT_MESSAGE_ID}`,
    ]);
  });

  test("rejects a current message that cannot fit the transcript budget", () => {
    expect(() =>
      assembleContextBundle(
        assemblyInput({
          currentMessage: messageWithRenderedLength({
            id: CURRENT_MESSAGE_ID,
            renderedLength: CONTEXT_BUDGETS.transcript + 1,
          }),
        }),
      ),
    ).toThrow("Current Discord message exceeds the transcript budget");
  });
});

describe("assembleContextBundle total-budget trimming", () => {
  test("trims the oldest transcript before any lore or memory", () => {
    const bundle = assembleContextBundle(
      assemblyInput({
        systemPolicy: "s".repeat(CONTEXT_BUDGETS.coreInstructions),
        personaProjection: "p".repeat(CONTEXT_BUDGETS.persona),
        rankedFragments: [
          {
            id: "memory-high",
            kind: "memory",
            content: "m".repeat(4000),
            rank: 2,
            memoryClaimId: "claim-high",
          },
          {
            id: "lore-low",
            kind: "lore",
            content: "l".repeat(4000),
            rank: 1,
          },
        ],
        currentMessage: messageWithRenderedLength({
          id: CURRENT_MESSAGE_ID,
          renderedLength: 10_000,
        }),
        transcript: [
          messageWithRenderedLength({
            id: "6001",
            renderedLength: 5000,
            createdAt: new Date("2026-08-08T10:01:00.000Z"),
          }),
          messageWithRenderedLength({
            id: "6002",
            renderedLength: 5000,
            createdAt: new Date("2026-08-08T10:02:00.000Z"),
          }),
        ],
      }),
    );

    expect(bundle.sizes.total).toBeLessThanOrEqual(CONTEXT_BUDGETS.total);
    expect(sourceIds(bundle)).not.toContain("discord:6001");
    expect(sourceIds(bundle)).toContain("discord:6002");
    expect(sourceIds(bundle)).toContain("memory-high");
    expect(sourceIds(bundle)).toContain("lore-low");
  });

  test("trims the lowest-ranked lore or memory after trimmable transcript is exhausted", () => {
    const bundle = assembleContextBundle(
      assemblyInput({
        systemPolicy: "s".repeat(CONTEXT_BUDGETS.coreInstructions),
        personaProjection: "p".repeat(CONTEXT_BUDGETS.persona),
        rankedFragments: [
          {
            id: "memory-high",
            kind: "memory",
            content: "m".repeat(4000),
            rank: 2,
            memoryClaimId: "claim-high",
          },
          {
            id: "lore-low",
            kind: "lore",
            content: "l".repeat(4000),
            rank: 1,
          },
        ],
        currentMessage: messageWithRenderedLength({
          id: CURRENT_MESSAGE_ID,
          renderedLength: CONTEXT_BUDGETS.transcript,
        }),
      }),
    );

    expect(bundle.sizes.total).toBeLessThanOrEqual(CONTEXT_BUDGETS.total);
    expect(sourceIds(bundle)).toContain("memory-high");
    expect(sourceIds(bundle)).not.toContain("lore-low");
    expect(sourceIds(bundle)).toContain(`discord:${CURRENT_MESSAGE_ID}`);
  });

  test("retains mandatory system policy and current message while trimming", () => {
    const bundle = assembleContextBundle(
      assemblyInput({
        systemPolicy: "s".repeat(CONTEXT_BUDGETS.coreInstructions),
        personaProjection: "p".repeat(CONTEXT_BUDGETS.persona),
        rankedFragments: [
          {
            id: "memory",
            kind: "memory",
            content: "m".repeat(CONTEXT_BUDGETS.loreAndMemory),
            rank: 1,
          },
        ],
        currentMessage: messageWithRenderedLength({
          id: CURRENT_MESSAGE_ID,
          renderedLength: 10_000,
        }),
        transcript: [
          messageWithRenderedLength({
            id: "7001",
            renderedLength: 10_000,
          }),
        ],
      }),
    );

    expect(sourceIds(bundle)).toContain("system-policy");
    expect(sourceIds(bundle)).toContain(`discord:${CURRENT_MESSAGE_ID}`);
    expect(
      bundle.sources.find(({ id }) => id === "system-policy")?.content,
    ).toBe("s".repeat(CONTEXT_BUDGETS.coreInstructions));
  });

  test("caps selected memory claims at the retrieval contract maximum", () => {
    const rankedFragments = Array.from(
      { length: CONTEXT_BUDGETS.maximumClaims + 1 },
      (_, index) => {
        const ordinal = String(index + 1);
        return {
          id: `memory-${ordinal}`,
          kind: "memory" as const,
          content: `memory-${ordinal}`,
          rank: CONTEXT_BUDGETS.maximumClaims + 1 - index,
          memoryClaimId: `claim-${ordinal}`,
        };
      },
    );

    const bundle = assembleContextBundle(assemblyInput({ rankedFragments }));

    expect(bundle.selectedMemoryClaimIds).toHaveLength(
      CONTEXT_BUDGETS.maximumClaims,
    );
    expect(bundle.selectedMemoryClaimIds).toEqual(
      Array.from(
        { length: CONTEXT_BUDGETS.maximumClaims },
        (_, index) => `claim-${String(index + 1)}`,
      ),
    );
    expect(sourceIds(bundle)).not.toContain(
      `memory-${String(CONTEXT_BUDGETS.maximumClaims + 1)}`,
    );
  });
});

describe("assembleContextBundle validation and provenance", () => {
  test("accepts at most 50 fetched transcript messages", () => {
    const fiftyMessages = Array.from(
      { length: CONTEXT_BUDGETS.transcriptFetchLimit },
      (_, index) => transcriptMessage({ id: String(10_000 + index) }),
    );

    expect(() =>
      assembleContextBundle(assemblyInput({ transcript: fiftyMessages })),
    ).not.toThrow();
    expect(() =>
      assembleContextBundle(
        assemblyInput({
          transcript: [...fiftyMessages, transcriptMessage({ id: "11000" })],
        }),
      ),
    ).toThrow();
  });

  test("includes each Discord message ID at most once across all sources", () => {
    const bundle = assembleContextBundle(
      assemblyInput({
        currentMessage: transcriptMessage({
          id: CURRENT_MESSAGE_ID,
          content: "authoritative current message",
        }),
        transcript: [
          transcriptMessage({
            id: CURRENT_MESSAGE_ID,
            content: "duplicate current transcript",
          }),
          transcriptMessage({
            id: "12001",
            content: "duplicate session transcript",
          }),
          transcriptMessage({
            id: "12002",
            content: "older duplicate",
            createdAt: new Date("2026-08-08T10:00:00.000Z"),
          }),
          transcriptMessage({
            id: "12002",
            content: "newer duplicate",
            createdAt: new Date("2026-08-08T11:00:00.000Z"),
          }),
        ],
        sessionEvents: [
          {
            id: "current-event",
            role: "user",
            content: "duplicate current session event",
            sequence: 3,
            discordMessageId: CURRENT_MESSAGE_ID,
          },
          {
            id: "transcript-event",
            role: "assistant",
            content: "authoritative session event",
            sequence: 2,
            discordMessageId: "12001",
          },
        ],
      }),
    );

    const ids = discordMessageIds(bundle);
    expect(ids).toHaveLength(new Set(ids).size);
    expect(ids.filter((id) => id === CURRENT_MESSAGE_ID)).toHaveLength(1);
    expect(ids.filter((id) => id === "12001")).toHaveLength(1);
    expect(ids.filter((id) => id === "12002")).toHaveLength(1);
    expect(bundle.assembled).toContain("authoritative current message");
    expect(bundle.assembled).not.toContain("duplicate current transcript");
    expect(bundle.assembled).toContain("authoritative session event");
    expect(bundle.assembled).not.toContain("duplicate session transcript");
    expect(bundle.assembled).toContain("newer duplicate");
    expect(bundle.assembled).not.toContain("older duplicate");
  });

  test("propagates transcript fetch failure without inventing transcript content", () => {
    const bundle = assembleContextBundle(
      assemblyInput({ transcriptFetchFailed: true }),
    );

    expect(bundle.transcriptFetchFailed).toBe(true);
    expect(bundle.sources.some(({ kind }) => kind === "transcript")).toBe(
      false,
    );
    expect(bundle.assembled).not.toContain("fetch failed");
  });
});
