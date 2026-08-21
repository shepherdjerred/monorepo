import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { TurnInputSchema } from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import {
  attachSelfMemoryProvenance,
  SelfMemorySchema,
} from "@shepherdjerred/birmel/agent-runtime/memory-extraction.ts";
import { applyMemoryCandidates } from "@shepherdjerred/birmel/memory/apply.ts";
import { findActivePersonaAliases } from "@shepherdjerred/birmel/memory/aliases.ts";
import { deserializeDiscordIds } from "@shepherdjerred/birmel/memory/serialization.ts";
import {
  createMemoryTestDatabase,
  type MemoryTestDatabase,
} from "./test-database.ts";

let database: MemoryTestDatabase | null = null;

function memoryDatabase(): MemoryTestDatabase {
  if (database === null) {
    throw new Error("Self-memory test database has not been initialized");
  }
  return database;
}

const turn = TurnInputSchema.parse({
  discordMessageId: "3000",
  guildId: "10",
  channelId: "20",
  userId: "30",
  username: "Alice",
  content:
    "Can I call you Compyutah? Can I also call you Computah? Please remember to check on me.",
  attachments: [],
  triggerKind: "mention",
  receivedAt: new Date("2026-08-18T12:00:00.000Z"),
});

const assistantMessage = {
  id: "4000",
  userId: "60",
  content:
    "Yes, you can call me Compyutah. You can also call me Computah. I will remember to check on you.",
};

beforeAll(async () => {
  database = await createMemoryTestDatabase();
});

afterAll(async () => {
  if (database !== null) {
    await database.cleanup();
    database = null;
  }
});

describe("curated self-memory persistence", () => {
  test("persists active aliases and a targeted commitment with paired provenance", async () => {
    const attached = attachSelfMemoryProvenance({
      selfMemories: [
        SelfMemorySchema.parse({
          kind: "accepted-alias",
          alias: "Compyutah",
          confidence: 1,
          salience: 1,
        }),
        SelfMemorySchema.parse({
          kind: "accepted-alias",
          alias: "Computah",
          confidence: 1,
          salience: 0.9,
        }),
        SelfMemorySchema.parse({
          kind: "commitment",
          scope: "user",
          targetUserId: "30",
          commitment: "I will remember to check on you.",
          topic: "check on you",
          confidence: 1,
          salience: 0.9,
          validFrom: null,
          validUntil: null,
        }),
      ],
      turn,
      assistantMessage,
      toolEvents: [],
    });
    expect(attached.rejectedCount).toBe(0);
    await applyMemoryCandidates(memoryDatabase().client, {
      context: {
        guildId: turn.guildId,
        channelId: turn.channelId,
        userId: turn.userId,
        personaId: "virmel",
        authorUserId: turn.userId,
        extractorModel: "memory-test",
      },
      candidates: attached.candidates.map(({ candidate, provenance }) => ({
        candidate,
        embedding: null,
        provenance,
      })),
    });

    const rows = await memoryDatabase().client.memoryClaim.findMany({
      include: { revisions: true },
      orderBy: { predicate: "asc" },
    });
    expect(rows).toHaveLength(3);
    const aliases = rows.filter(
      ({ predicate }) => predicate === "identity.alias",
    );
    expect(aliases.map(({ value }) => value).toSorted()).toEqual(
      ["Compyutah", "Computah"].toSorted(),
    );
    const alias = aliases.find(({ value }) => value === "Compyutah");
    expect(alias).toMatchObject({
      guildId: "10",
      scope: "persona",
      personaId: "virmel",
      value: "Compyutah",
      origin: "explicit",
    });
    expect(
      deserializeDiscordIds(
        alias?.revisions[0]?.sourceDiscordMessageIds ?? "[]",
      ),
    ).toEqual(["3000", "4000"]);
    expect(alias?.revisions[0]?.authorUserId).toBe("60");

    const commitment = rows.find(({ predicate }) => predicate === "commitment");
    expect(commitment).toMatchObject({
      guildId: "10",
      scope: "user",
      userId: "30",
      subject: "Birmel commitment:check on you",
      value: "I will remember to check on you.",
    });
    expect(deserializeDiscordIds(commitment?.relatedUserIds ?? "[]")).toEqual([
      "30",
    ]);

    await expect(
      findActivePersonaAliases(memoryDatabase().client, {
        guildId: "10",
        personaId: "virmel",
      }),
    ).resolves.toEqual(
      ["Compyutah", "Computah"].toSorted((left, right) =>
        left.localeCompare(right),
      ),
    );
    await expect(
      findActivePersonaAliases(memoryDatabase().client, {
        guildId: "11",
        personaId: "virmel",
      }),
    ).resolves.toEqual([]);
  });
});
