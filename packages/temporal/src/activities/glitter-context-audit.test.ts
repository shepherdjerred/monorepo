import { describe, expect, test, vi } from "vitest";
import {
  GenerationStateDocumentSchema,
  PeopleDocumentSchema,
  RelationshipsDocumentSchema,
  StyleCardSchema,
} from "@shepherdjerred/glitter-context/schema";
import {
  CurrentMessageSchema,
  GuildSnapshotSchema,
  StoredObjectSchema,
  type CurrentMessage,
} from "#shared/glitter-corpus.ts";
import { generationRequestSha256 } from "./glitter-context-refresh-cache.ts";
import { auditGlitterContextGenerationCache } from "./glitter-context-audit.ts";
import * as glitterLlm from "./glitter-context-refresh-llm.ts";
import {
  STYLE_ARRAY_FIELDS,
  StyleSynthesisSchema,
} from "./glitter-context-refresh-style-schemas.ts";

const SNAPSHOT_SHA = "a".repeat(64);
const CREATED_AT = "2026-08-30T12:00:00.000Z";
const PERSON_ID = "aaron";
const DISCORD_ID = String(10n ** 17n);

function message(index: number): CurrentMessage {
  const messageId = String(100_000_000_000_000_000n + BigInt(index));
  return CurrentMessageSchema.parse({
    schemaVersion: 1,
    source: "discord-rest",
    selectedObservationKey: `raw/${messageId}`,
    selectedObservedAt: CREATED_AT,
    rawSha256: SNAPSHOT_SHA,
    guildId: "1000",
    guildSlug: "glitter-boys",
    channelId: "2000",
    messageId,
    author: {
      id: DISCORD_ID,
      username: "aaron",
      globalName: "Aaron",
      discriminator: "0",
      bot: false,
      avatar: null,
    },
    content: `safe message ${String(index)}`,
    timestamp: CREATED_AT,
    editedTimestamp: null,
    type: 0,
    flags: "0",
    pinned: false,
    tts: false,
    attachments: [],
    referencedMessageId: null,
  });
}

function corpus(messages: CurrentMessage[]) {
  const inventoryObject = StoredObjectSchema.parse({
    key: "inventory.json",
    sha256: SNAPSHOT_SHA,
    receipt: {
      store: "seaweedfs",
      bucket: "corpus",
      key: "inventory.json",
      sha256: SNAPSHOT_SHA,
      etag: "etag",
      writtenAt: CREATED_AT,
    },
  });
  return {
    reference: {
      snapshotId: "00000000-0000-4000-8000-000000000999",
      snapshotKey: "snapshot.json",
      snapshotSha256: SNAPSHOT_SHA,
    },
    snapshot: GuildSnapshotSchema.parse({
      schemaVersion: 1,
      snapshotId: "00000000-0000-4000-8000-000000000999",
      guildId: "1000",
      createdAt: CREATED_AT,
      inventoryObject,
      channelManifestObjects: [],
      expectedChannelIds: [],
      completeChannelIds: [],
      uniqueMessageCount: messages.length,
      complete: true,
    }),
    messages,
  };
}

async function existingCard() {
  return StyleCardSchema.parse(
    await Bun.file(
      `${import.meta.dir}/../../../glitter-context/data/style-cards/aaron_style.json`,
    ).json(),
  );
}

function commonDocuments(relationshipSnapshot: string | null) {
  return {
    peopleDocument: PeopleDocumentSchema.parse({
      schemaVersion: 1,
      people: [
        {
          id: PERSON_ID,
          displayName: "Aaron",
          kind: "person",
          aliases: [],
          discordUserIds: [DISCORD_ID],
        },
      ],
    }),
    relationshipsDocument: RelationshipsDocumentSchema.parse({
      schemaVersion: 1,
      events: [],
    }),
    generationState: GenerationStateDocumentSchema.parse({
      schemaVersion: 1,
      relationshipSourceSnapshotChecksum: relationshipSnapshot,
      relationshipRefreshedAt: null,
      people: [],
    }),
  };
}

function storedArtifact(input: {
  key: string;
  model: string;
  callSite: string;
  response: unknown;
}) {
  const requestSha256 = input.key.split("/").at(-1)?.replace(".json", "");
  if (requestSha256 === undefined) {
    throw new Error(`invalid artifact key ${input.key}`);
  }
  return {
    schemaVersion: 3,
    ownerRunId: "00000000-0000-4000-8000-000000000001",
    model: input.model,
    callSite: input.callSite,
    requestSha256,
    responseSha256: generationRequestSha256(input.response),
    response: input.response,
    usage: {
      inputTokens: 10,
      outputTokens: 2,
      cachedInputTokens: 0,
      costUsd: 0.01,
    },
  };
}

describe("Glitter context zero-inference audit", () => {
  test("reports extraction misses and blocks dependent synthesis", async () => {
    const messages = Array.from({ length: 30 }, (_, index) => message(index));
    const result = await auditGlitterContextGenerationCache({
      corpus: corpus(messages),
      ...commonDocuments(SNAPSHOT_SHA),
      existingCards: new Map([[PERSON_ID, await existingCard()]]),
      artifactReader: { read: () => Promise.resolve() },
      now: new Date(CREATED_AT),
    });

    expect(result.eligiblePeople).toEqual([PERSON_ID]);
    expect(result.cacheHits).toBe(0);
    expect(result.cacheMisses).toBe(1);
    expect(result.blockedStages).toEqual([
      expect.objectContaining({
        stage: "style-synthesis",
        personId: PERSON_ID,
        reason: expect.stringContaining("missing upstream chunk artifacts"),
      }),
    ]);
    expect(result.artifactKeys).toHaveLength(1);
    expect(result.worstCaseUncachedCostUsd).toBeGreaterThan(0);
  });

  test("continues to synthesis only after an exact upstream hit", async () => {
    const messages = Array.from({ length: 30 }, (_, index) => message(index));
    const firstMessage = messages[0];
    if (firstMessage === undefined) {
      throw new Error("missing fixture message");
    }
    const generate = vi.spyOn(glitterLlm, "generateGlitterObject");
    const result = await auditGlitterContextGenerationCache({
      corpus: corpus(messages),
      ...commonDocuments(SNAPSHOT_SHA),
      existingCards: new Map([[PERSON_ID, await existingCard()]]),
      artifactReader: {
        read: async (key) => {
          if (key.includes("/glitter-style-chunk/")) {
            return storedArtifact({
              key,
              model: "gpt-5.6-luna",
              callSite: "glitter-style-chunk",
              response: {
                outcome: "success",
                value: {
                  observations: [
                    {
                      field: "voice",
                      claim: "Uses concise messages",
                      confidence: 0.9,
                      evidenceMessageIds: [firstMessage.messageId],
                    },
                  ],
                  representativeMessages: [],
                },
              },
            });
          }
          return;
        },
      },
      now: new Date(CREATED_AT),
    });

    expect(result.cacheHits).toBe(1);
    expect(result.cacheMisses).toBe(1);
    expect(result.artifactKeys[1]).toContain("glitter-style-synthesis");
    expect(result.blockedStages[0]?.reason).toContain("missing");
    expect(generate).not.toHaveBeenCalled();
    generate.mockRestore();
  });

  test("validates an exact relationship artifact without model calls", async () => {
    const generate = vi.spyOn(glitterLlm, "generateGlitterObject");
    const result = await auditGlitterContextGenerationCache({
      corpus: corpus([message(1)]),
      ...commonDocuments(null),
      existingCards: new Map(),
      artifactReader: {
        read: async (key) =>
          storedArtifact({
            key,
            model: "gpt-5.6-luna",
            callSite: "glitter-context-relationships",
            response: { outcome: "success", value: { proposals: [] } },
          }),
      },
      now: new Date(CREATED_AT),
    });

    expect(result.eligiblePeople).toEqual([]);
    expect(result.cacheHits).toBe(1);
    expect(result.cacheMisses).toBe(0);
    expect(result.blockedStages).toEqual([]);
    expect(generate).not.toHaveBeenCalled();
    generate.mockRestore();
  });
});

describe("Glitter context audit failure parity", () => {
  test("reports cached relationship failures and invalid proposals", async () => {
    const failed = await auditGlitterContextGenerationCache({
      corpus: corpus([message(1)]),
      ...commonDocuments(null),
      existingCards: new Map(),
      artifactReader: {
        read: async (key) =>
          storedArtifact({
            key,
            model: "gpt-5.6-luna",
            callSite: "glitter-context-relationships",
            response: {
              outcome: "failure",
              error: "cached parse failure",
              rawContent: null,
            },
          }),
      },
      now: new Date(CREATED_AT),
    });
    expect(failed.blockedStages).toEqual([
      {
        stage: "relationships",
        reason: "cached generation failure: cached parse failure",
      },
    ]);

    const invalid = await auditGlitterContextGenerationCache({
      corpus: corpus([message(1), message(2)]),
      ...commonDocuments(null),
      existingCards: new Map(),
      artifactReader: {
        read: async (key) =>
          storedArtifact({
            key,
            model: "gpt-5.6-luna",
            callSite: "glitter-context-relationships",
            response: {
              outcome: "success",
              value: {
                proposals: [
                  {
                    sourceId: PERSON_ID,
                    targetId: "unknown-person",
                    kind: "friendship",
                    label: "friends",
                    direction: "undirected",
                    effectiveAt: null,
                    evidenceMessageIds: [
                      message(1).messageId,
                      message(2).messageId,
                    ],
                    confidence: 0.99,
                    rationale: "Explicitly stated friendship",
                  },
                ],
              },
            },
          }),
      },
      now: new Date(CREATED_AT),
    });
    expect(invalid.blockedStages[0]?.reason).toContain(
      "cached proposal validation failed",
    );
  });

  test("reports exhaustion of all cached synthesis repairs", async () => {
    const messages = Array.from({ length: 30 }, (_, index) => message(index));
    const invalidSynthesis = StyleSynthesisSchema.parse({
      patches: STYLE_ARRAY_FIELDS.map((field) => ({
        field,
        priorDecisions: [],
        additions: [],
      })),
      summaryPatch: { priorDecisions: [], additions: [] },
      leaguePatch: { priorDecisions: [], additions: [] },
      quoteMessageIds: messages.slice(0, 20).map((entry) => entry.messageId),
      sampleMessageIds: messages.map((entry) => entry.messageId),
      situational_examples: {
        provenance: "synthetic",
        happy_or_excited: ["one", "two", "three"],
        angry_or_frustrated: ["one", "two", "three"],
        sad_or_disappointed: ["one", "two", "three"],
        supportive_or_caring: ["one", "two", "three"],
        playful_or_teasing: ["one", "two", "three"],
        neutral_or_logistical: ["one", "two", "three"],
      },
    });
    const firstMessage = messages[0];
    if (firstMessage === undefined) {
      throw new Error("missing first message fixture");
    }
    const result = await auditGlitterContextGenerationCache({
      corpus: corpus(messages),
      ...commonDocuments(SNAPSHOT_SHA),
      existingCards: new Map([[PERSON_ID, await existingCard()]]),
      artifactReader: {
        read: async (key) =>
          key.includes("/glitter-style-chunk/")
            ? storedArtifact({
                key,
                model: "gpt-5.6-luna",
                callSite: "glitter-style-chunk",
                response: {
                  outcome: "success",
                  value: {
                    observations: [
                      {
                        field: "voice",
                        claim: "Uses concise messages",
                        confidence: 0.9,
                        evidenceMessageIds: [firstMessage.messageId],
                      },
                    ],
                    representativeMessages: [],
                  },
                },
              })
            : storedArtifact({
                key,
                model: "gpt-5.6-luna",
                callSite: key.includes("synthesis-repair")
                  ? "glitter-style-synthesis-repair"
                  : "glitter-style-synthesis",
                response: { outcome: "success", value: invalidSynthesis },
              }),
      },
      now: new Date(CREATED_AT),
    });

    expect(result.cacheHits).toBe(5);
    expect(result.blockedStages[0]?.reason).toContain(
      "cached synthesis exhausted all repairs",
    );
  });

  test("fails closed on a malformed artifact", async () => {
    const messages = Array.from({ length: 30 }, (_, index) => message(index));
    await expect(
      auditGlitterContextGenerationCache({
        corpus: corpus(messages),
        ...commonDocuments(SNAPSHOT_SHA),
        existingCards: new Map([[PERSON_ID, await existingCard()]]),
        artifactReader: {
          read: async () => ({ schemaVersion: 3, response: {} }),
        },
        now: new Date(CREATED_AT),
      }),
    ).rejects.toThrow();
  });
});
