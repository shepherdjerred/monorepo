import type { PrismaClient } from "#generated/prisma/client/index.js";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import type { MemoryCandidate } from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import {
  applyMemoryCandidates,
  correctMemoryClaim,
} from "@shepherdjerred/birmel/memory/apply.ts";
import {
  forgetMemoryClaim,
  getMemoryClaimHistory,
  inspectMemoryClaim,
  listMemoryClaims,
  privacyEraseMemoryClaim,
  rememberMemoryClaim,
} from "@shepherdjerred/birmel/memory/operations.ts";
import { retrieveMemoryClaims } from "@shepherdjerred/birmel/memory/retrieve.ts";
import type {
  MemoryApplicationContext,
  MemoryCandidateEnvelope,
} from "@shepherdjerred/birmel/memory/schemas.ts";
import {
  createMemoryTestDatabase,
  type MemoryTestDatabase,
} from "./test-database.ts";

const BASE_CONTEXT: MemoryApplicationContext = {
  guildId: "100",
  channelId: "200",
  userId: "300",
  personaId: "captain-glitter",
  authorUserId: "300",
  extractorModel: "extractor-test",
};

let database: MemoryTestDatabase | null = null;

function client(): PrismaClient {
  if (database === null) {
    throw new Error("Memory test database has not been initialized");
  }
  return database.client;
}

function candidate(overrides: Partial<MemoryCandidate> = {}): MemoryCandidate {
  return {
    scope: "user",
    subject: "Jerred",
    predicate: "favorite drink",
    value: "coffee",
    confidence: 0.9,
    salience: 0.8,
    origin: "explicit",
    validFrom: null,
    validUntil: null,
    relatedUserIds: [],
    sourceDiscordMessageIds: ["900"],
    ...overrides,
  };
}

type ApplyFixture = {
  candidate?: Partial<MemoryCandidate>;
  context?: Partial<MemoryApplicationContext>;
  embedding?: number[] | null;
};

async function applyFixture(fixture: ApplyFixture = {}) {
  return applyMemoryCandidates(client(), {
    context: { ...BASE_CONTEXT, ...fixture.context },
    candidates: [
      {
        candidate: candidate(fixture.candidate),
        embedding: fixture.embedding ?? null,
      },
    ],
  });
}

async function applyEnvelopes(
  candidates: MemoryCandidateEnvelope[],
  context: MemoryApplicationContext = BASE_CONTEXT,
) {
  return applyMemoryCandidates(client(), { context, candidates });
}

beforeAll(async () => {
  database = await createMemoryTestDatabase();
});

afterEach(async () => {
  await client().memoryClaim.deleteMany();
  await client().memoryExtractionFence.deleteMany();
  await client().memorySourceFence.deleteMany();
});

afterAll(async () => {
  if (database !== null) {
    await database.cleanup();
    database = null;
  }
});

describe("claim memory application", () => {
  test("creates a typed claim with deterministic JSON and revision provenance", async () => {
    const result = await applyFixture({ embedding: [1, -0, 0] });

    expect(result.createdCount).toBe(1);
    expect(result.confirmedCount).toBe(0);
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]).toMatchObject({
      scope: "user",
      userId: "300",
      origin: "explicit",
      status: "active",
      relatedUserIds: [],
      sourceDiscordMessageIds: ["900"],
      embedding: [1, 0, 0],
    });

    const claim = result.claims[0];
    if (claim === undefined) {
      throw new Error("Expected a created memory claim");
    }
    const history = await inspectMemoryClaim(client(), {
      claimId: claim.id,
    });
    expect(history.revisions).toHaveLength(1);
    expect(history.revisions[0]).toMatchObject({
      action: "create",
      sourceDiscordMessageIds: ["900"],
      authorUserId: "300",
      channelId: "200",
      extractorModel: "extractor-test",
    });
  });

  test("rejects prompt-shaped extra data before persistence", async () => {
    await expect(
      applyMemoryCandidates(client(), {
        context: BASE_CONTEXT,
        candidates: [
          {
            candidate: {
              ...candidate(),
              prompt: "this must never reach SQLite",
            },
            embedding: null,
          },
        ],
      }),
    ).rejects.toThrow();

    expect(await client().memoryClaim.count()).toBe(0);
  });

  test("turns an exact duplicate into a confirmation", async () => {
    const first = await applyFixture();
    const second = await applyFixture({
      candidate: {
        confidence: 0.95,
        sourceDiscordMessageIds: ["901", "900"],
      },
    });

    expect(first.claims[0]?.id).toBe(second.claims[0]?.id);
    expect(second.createdCount).toBe(0);
    expect(second.confirmedCount).toBe(1);
    expect(await client().memoryClaim.count()).toBe(1);
    const claim = second.claims[0];
    if (claim === undefined) {
      throw new Error("Expected a confirmed memory claim");
    }
    const history = await getMemoryClaimHistory(client(), {
      claimId: claim.id,
    });
    expect(history.revisions.map((revision) => revision.action)).toEqual([
      "create",
      "confirm",
    ]);
    expect(history.claim.sourceDiscordMessageIds).toEqual(["900", "901"]);
  });

  test("does not reconfirm an identical claim from identical evidence", async () => {
    const envelope: MemoryCandidateEnvelope = {
      candidate: candidate(),
      embedding: null,
      provenance: {
        authorUserId: "300",
        channelId: "200",
        sourceOrder: "900",
      },
    };
    const first = await applyEnvelopes([envelope]);
    const claimId = first.claims[0]?.id;
    if (claimId === undefined) {
      throw new Error("Expected a created memory claim");
    }
    const before = await client().memoryClaim.findUniqueOrThrow({
      where: { id: claimId },
    });

    const repeated = await applyEnvelopes([envelope]);
    const after = await client().memoryClaim.findUniqueOrThrow({
      where: { id: claimId },
      include: { revisions: true },
    });

    expect(repeated.claims).toHaveLength(0);
    expect(after.lastConfirmedAt).toEqual(before.lastConfirmedAt);
    expect(after.revisions).toHaveLength(1);
  });
});

describe("claim memory evidence updates", () => {
  test("retains newly discovered older evidence without refreshing recency", async () => {
    const first = await applyEnvelopes([
      {
        candidate: candidate({ sourceDiscordMessageIds: ["902"] }),
        embedding: null,
        provenance: {
          authorUserId: "300",
          channelId: "200",
          sourceOrder: "902",
        },
      },
    ]);
    const claimId = first.claims[0]?.id;
    if (claimId === undefined) {
      throw new Error("Expected a created memory claim");
    }
    const before = await client().memoryClaim.findUniqueOrThrow({
      where: { id: claimId },
    });

    const expanded = await applyEnvelopes([
      {
        candidate: candidate({ sourceDiscordMessageIds: ["901", "902"] }),
        embedding: null,
        provenance: {
          authorUserId: "300",
          channelId: "200",
          sourceOrder: "902",
        },
      },
    ]);
    const after = await client().memoryClaim.findUniqueOrThrow({
      where: { id: claimId },
      include: { revisions: true },
    });
    expect(expanded.confirmedCount).toBe(1);
    expect(after.lastConfirmedAt).toEqual(before.lastConfirmedAt);
    expect(after.revisions.at(-1)?.sourceDiscordMessageIds).toBe(
      '["901","902"]',
    );

    await privacyEraseMemoryClaim(client(), {
      claimId,
      sourceDiscordMessageId: "903",
    });
    const replayedParaphrase = await applyEnvelopes([
      {
        candidate: candidate({
          subject: "Jerred preferences",
          predicate: "drink selection",
          sourceDiscordMessageIds: ["901"],
        }),
        embedding: null,
        provenance: {
          authorUserId: "300",
          channelId: "200",
          sourceOrder: "901",
        },
      },
    ]);
    expect(replayedParaphrase.claims).toHaveLength(0);
  });

  test("promotes older explicit evidence over a newer inferred duplicate", async () => {
    const inferred = await applyEnvelopes([
      {
        candidate: candidate({
          origin: "inferred",
          sourceDiscordMessageIds: ["902"],
        }),
        embedding: null,
        provenance: {
          authorUserId: "300",
          channelId: "200",
          sourceOrder: "902",
        },
      },
    ]);
    const claimId = inferred.claims[0]?.id;
    if (claimId === undefined) {
      throw new Error("Expected an inferred memory claim");
    }

    const promoted = await applyEnvelopes([
      {
        candidate: candidate({ sourceDiscordMessageIds: ["901"] }),
        embedding: null,
        provenance: {
          authorUserId: "300",
          channelId: "200",
          sourceOrder: "901",
        },
      },
    ]);
    const stored = await client().memoryClaim.findUniqueOrThrow({
      where: { id: claimId },
      include: { revisions: true },
    });

    expect(promoted.confirmedCount).toBe(1);
    expect(stored.origin).toBe("explicit");
    expect(stored.revisions).toHaveLength(2);
    expect(stored.revisions.at(-1)?.sourceDiscordMessageIds).toBe('["901"]');
  });

  test("rolls back the whole extraction batch when one candidate is invalid", async () => {
    await expect(
      applyEnvelopes([
        { candidate: candidate(), embedding: null },
        {
          candidate: candidate({
            scope: "relationship",
            subject: "Jerred and Alice",
            predicate: "relationship",
            relatedUserIds: ["300"],
            sourceDiscordMessageIds: ["902"],
          }),
          embedding: null,
        },
      ]),
    ).rejects.toThrow("at least two related users");

    expect(await client().memoryClaim.count()).toBe(0);
    expect(await client().memoryRevision.count()).toBe(0);
  });
});

describe("claim precedence and temporal conflicts", () => {
  test("supersedes an inferred contradiction with a newer explicit value", async () => {
    const inferred = await applyFixture({
      candidate: { value: "tea", origin: "inferred", confidence: 0.6 },
    });
    const explicit = await applyFixture({
      candidate: { value: "coffee", sourceDiscordMessageIds: ["901"] },
    });

    expect(explicit.supersededCount).toBe(1);
    const inferredId = inferred.claims[0]?.id;
    if (inferredId === undefined) {
      throw new Error("Expected an inferred claim");
    }
    const oldHistory = await inspectMemoryClaim(client(), {
      claimId: inferredId,
    });
    expect(oldHistory.claim.status).toBe("superseded");
    expect(oldHistory.revisions.at(-1)?.action).toBe("supersede");

    const retrieved = await retrieveMemoryClaims(client(), {
      guildId: "100",
      userIds: ["300"],
      query: "favorite drink",
    });
    expect(retrieved.claims.map((entry) => entry.claim.value)).toEqual([
      "coffee",
    ]);
  });

  test("keeps an inferred contradiction uncertain beside an explicit claim", async () => {
    const explicit = await applyFixture();
    const inferred = await applyFixture({
      candidate: {
        value: "tea",
        origin: "inferred",
        confidence: 0.7,
        sourceDiscordMessageIds: ["901"],
      },
    });

    expect(inferred.uncertainCount).toBe(1);
    expect(explicit.claims[0]?.status).toBe("active");
    expect(inferred.claims[0]?.status).toBe("uncertain");

    const retrieved = await retrieveMemoryClaims(client(), {
      guildId: "100",
      userIds: ["300"],
      query: "favorite drink",
    });
    expect(retrieved.claims).toHaveLength(2);
    expect(retrieved.claims.every((entry) => entry.uncertain)).toBeTrue();
    expect(
      retrieved.claims.every((entry) => entry.conflictingClaimIds.length === 1),
    ).toBeTrue();
  });

  test("keeps equal-priority contradictions from one source unresolved", async () => {
    const fromSameMessage = (value: string): MemoryCandidateEnvelope => ({
      candidate: candidate({
        value,
        sourceDiscordMessageIds: ["901"],
      }),
      embedding: null,
      provenance: {
        authorUserId: BASE_CONTEXT.authorUserId,
        channelId: BASE_CONTEXT.channelId,
        sourceOrder: "901",
      },
    });

    const result = await applyEnvelopes([
      fromSameMessage("coffee"),
      fromSameMessage("tea"),
    ]);
    expect(result.supersededCount).toBe(0);
    expect(result.uncertainCount).toBe(1);
    expect(
      await listMemoryClaims(client(), {
        guildId: BASE_CONTEXT.guildId,
        statuses: ["active", "uncertain"],
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "coffee", status: "active" }),
        expect.objectContaining({ value: "tea", status: "uncertain" }),
      ]),
    );
  });
});

describe("claim source ordering", () => {
  test("compares chronology only among equal-priority contradictions", async () => {
    const envelope = (
      value: string,
      origin: "explicit" | "inferred",
      sourceOrder: string,
    ): MemoryCandidateEnvelope => ({
      candidate: candidate({
        value,
        origin,
        sourceDiscordMessageIds: [sourceOrder],
      }),
      embedding: null,
      provenance: {
        authorUserId: BASE_CONTEXT.authorUserId,
        channelId: BASE_CONTEXT.channelId,
        sourceOrder,
      },
    });

    await applyEnvelopes([envelope("coffee", "explicit", "900")]);
    await applyEnvelopes([envelope("tea", "inferred", "902")]);
    const corrected = await applyEnvelopes([
      envelope("water", "explicit", "901"),
    ]);

    expect(corrected.supersededCount).toBe(2);
    expect(
      await listMemoryClaims(client(), {
        guildId: BASE_CONTEXT.guildId,
        statuses: ["active"],
      }),
    ).toEqual([expect.objectContaining({ value: "water" })]);
  });

  test("applies contradictory automatic candidates by source chronology and provenance", async () => {
    const older = {
      candidate: candidate({
        value: "tea",
        relatedUserIds: [],
        sourceDiscordMessageIds: ["901"],
      }),
      embedding: [0.1, 0.2],
      provenance: {
        authorUserId: "400",
        channelId: "201",
        sourceOrder: "901",
      },
    };
    const newer = {
      candidate: candidate({
        value: "coffee",
        relatedUserIds: [],
        sourceDiscordMessageIds: ["902"],
      }),
      embedding: [0.3, 0.4],
      provenance: {
        authorUserId: "400",
        channelId: "201",
        sourceOrder: "902",
      },
    };

    await applyEnvelopes([newer, older]);
    const claims = await listMemoryClaims(client(), {
      guildId: BASE_CONTEXT.guildId,
      statuses: ["active", "superseded"],
    });
    const active = claims.find(({ status }) => status === "active");
    const superseded = claims.find(({ status }) => status === "superseded");
    expect(active).toMatchObject({ value: "coffee", userId: "400" });
    expect(superseded).toMatchObject({ value: "tea", userId: "400" });
    if (active == null) {
      throw new Error("Expected the newer memory claim to be active");
    }
    const history = await getMemoryClaimHistory(client(), {
      claimId: active.id,
    });
    expect(history.revisions[0]).toMatchObject({
      authorUserId: "400",
      channelId: "201",
      sourceDiscordMessageIds: ["902"],
    });

    const replay = await applyEnvelopes([older]);
    expect(replay.confirmedCount).toBe(0);
    expect(
      await listMemoryClaims(client(), {
        guildId: BASE_CONTEXT.guildId,
        statuses: ["active"],
      }),
    ).toEqual([expect.objectContaining({ value: "coffee", userId: "400" })]);
  });

  test("automatic extraction cannot reactivate a tombstone but explicit remember can", async () => {
    const created = await applyFixture();
    const claim = created.claims[0];
    if (claim == null) {
      throw new Error("Expected an initial memory claim");
    }
    await forgetMemoryClaim(client(), {
      claimId: claim.id,
      sourceDiscordMessageIds: ["901"],
      authorUserId: BASE_CONTEXT.authorUserId,
      channelId: BASE_CONTEXT.channelId,
      extractorModel: BASE_CONTEXT.extractorModel,
    });

    const automatic = await applyEnvelopes([
      {
        candidate: candidate({ sourceDiscordMessageIds: ["900"] }),
        embedding: [1, 0],
        provenance: {
          authorUserId: BASE_CONTEXT.authorUserId,
          channelId: BASE_CONTEXT.channelId,
          sourceOrder: "900",
        },
      },
    ]);
    expect(automatic.confirmedCount).toBe(0);
    const stillForgotten = await inspectMemoryClaim(client(), {
      claimId: claim.id,
    });
    expect(stillForgotten.claim).toMatchObject({ status: "forgotten" });
    const oldAlternative = await applyEnvelopes([
      {
        candidate: candidate({
          value: "tea",
          sourceDiscordMessageIds: ["900"],
        }),
        embedding: null,
        provenance: {
          authorUserId: BASE_CONTEXT.authorUserId,
          channelId: BASE_CONTEXT.channelId,
          sourceOrder: "900",
        },
      },
    ]);
    expect(oldAlternative.claims).toHaveLength(0);

    const remembered = await rememberMemoryClaim(client(), {
      context: BASE_CONTEXT,
      candidate: candidate({ sourceDiscordMessageIds: ["902"] }),
      embedding: [0, 1],
      sourceOrder: "902",
    });
    expect(remembered.claim).toMatchObject({
      id: claim.id,
      status: "active",
    });
  });

  test("keeps non-overlapping temporal values and retrieves the valid one", async () => {
    await applyFixture({
      candidate: {
        predicate: "employer",
        value: "Old Company",
        validUntil: "2020-12-31T23:59:59.000Z",
      },
    });
    await applyFixture({
      candidate: {
        predicate: "employer",
        value: "New Company",
        validFrom: "2021-01-01T00:00:00.000Z",
        sourceDiscordMessageIds: ["901"],
      },
    });

    expect(
      await client().memoryClaim.count({ where: { status: "active" } }),
    ).toBe(2);
    const past = await retrieveMemoryClaims(client(), {
      guildId: "100",
      userIds: ["300"],
      query: "employer",
      at: new Date("2019-01-01T00:00:00.000Z"),
    });
    const present = await retrieveMemoryClaims(client(), {
      guildId: "100",
      userIds: ["300"],
      query: "employer",
      at: new Date("2022-01-01T00:00:00.000Z"),
    });

    expect(past.claims[0]?.claim.value).toBe("Old Company");
    expect(present.claims[0]?.claim.value).toBe("New Company");
  });
});

describe("scoped and ranked retrieval", () => {
  test("isolates all scopes and resolves relationship participants", async () => {
    await applyFixture({
      candidate: {
        scope: "guild",
        subject: "All members",
        predicate: "rule",
        value: "Be kind",
      },
    });
    await applyFixture({
      candidate: {
        scope: "channel",
        subject: "This channel",
        predicate: "preference",
        value: "Short answers",
      },
    });
    await applyFixture({
      context: { channelId: "201" },
      candidate: {
        scope: "channel",
        subject: "Other channel",
        predicate: "topic",
        value: "Spoilers",
      },
    });
    await applyFixture({
      context: { personaId: "other-persona" },
      candidate: {
        scope: "persona",
        subject: "Other persona",
        predicate: "voice",
        value: "Formal",
      },
    });
    await applyFixture({
      candidate: {
        scope: "persona",
        subject: "Captain Glitter",
        predicate: "voice",
        value: "Playful",
      },
    });
    await applyFixture({
      candidate: {
        scope: "user",
        subject: "Alice",
        predicate: "favorite game",
        value: "Chess",
        relatedUserIds: ["400"],
      },
    });
    await applyFixture({
      candidate: {
        scope: "user",
        subject: "Jerred",
        predicate: "timezone",
        value: "Pacific",
      },
    });
    await applyFixture({
      candidate: {
        scope: "relationship",
        subject: "Jerred and Alice",
        predicate: "relationship",
        value: "Friends",
        relatedUserIds: ["400", "300"],
      },
    });
    await applyFixture({
      context: { guildId: "101" },
      candidate: {
        scope: "guild",
        subject: "Other guild",
        predicate: "rule",
        value: "Unrelated",
      },
    });

    const retrieved = await retrieveMemoryClaims(client(), {
      guildId: "100",
      channelId: "200",
      personaId: "captain-glitter",
      userIds: ["300"],
      relationshipUserIds: ["300", "400"],
      query: "friends and channel rules",
    });
    const subjects = retrieved.claims.map((entry) => entry.claim.subject);

    expect(subjects).toContain("All members");
    expect(subjects).toContain("This channel");
    expect(subjects).toContain("Captain Glitter");
    expect(subjects).toContain("Jerred");
    expect(subjects).toContain("Jerred and Alice");
    expect(subjects).not.toContain("Other channel");
    expect(subjects).not.toContain("Other persona");
    expect(subjects).not.toContain("Alice");
    expect(subjects).not.toContain("Other guild");
    const relationship = retrieved.claims.find(
      (entry) => entry.claim.scope === "relationship",
    );
    expect(relationship?.claim.relatedUserIds).toEqual(["300", "400"]);
  });
});

describe("mandatory and similarity retrieval", () => {
  test("places active rules and explicit preferences before ordinary facts", async () => {
    await applyFixture({
      candidate: {
        scope: "guild",
        subject: "Server",
        predicate: "rule",
        value: "Never ping everyone",
        confidence: 0.1,
        salience: 0.1,
      },
    });
    await applyFixture({
      candidate: {
        scope: "channel",
        subject: "Jerred",
        predicate: "preference",
        value: "Use concise replies",
        confidence: 0.1,
        salience: 0.1,
      },
    });
    for (let index = 0; index < 14; index += 1) {
      await applyFixture({
        candidate: {
          subject: `High ranking fact ${String(index)}`,
          predicate: "project detail",
          value: "Birmel deployment architecture",
          confidence: 1,
          salience: 1,
          sourceDiscordMessageIds: [String(1000 + index)],
        },
      });
    }

    const retrieved = await retrieveMemoryClaims(client(), {
      guildId: "100",
      channelId: "200",
      userIds: ["300"],
      query: "Birmel deployment architecture",
      limit: 2,
    });

    expect(retrieved.claims).toHaveLength(2);
    expect(retrieved.claims.every((entry) => entry.mandatory)).toBeTrue();
    expect(
      retrieved.claims.map((entry) => entry.claim.predicate).sort(),
    ).toEqual(["preference", "rule"]);
  });

  test("combines lexical and optional semantic similarity deterministically", async () => {
    await applyFixture({
      candidate: {
        subject: "Coffee setup",
        predicate: "drink equipment",
        value: "Espresso machine",
      },
      embedding: [1, 0],
    });
    await applyFixture({
      candidate: {
        subject: "Weekend trail",
        predicate: "outdoor hobby",
        value: "Mountain hiking",
        sourceDiscordMessageIds: ["901"],
      },
      embedding: [0, 1],
    });

    const lexical = await retrieveMemoryClaims(client(), {
      guildId: "100",
      userIds: ["300"],
      query: "espresso coffee equipment",
    });
    const semantic = await retrieveMemoryClaims(client(), {
      guildId: "100",
      userIds: ["300"],
      query: "unrelated words",
      queryEmbedding: [0, 1],
    });

    expect(lexical.claims[0]?.claim.subject).toBe("Coffee setup");
    expect(semantic.claims[0]?.claim.subject).toBe("Weekend trail");
  });
});

describe("composite retrieval ranking", () => {
  test("combines scope, confidence, salience, and recency scores", async () => {
    const guild = await applyFixture({
      candidate: {
        scope: "guild",
        subject: "Guild fact",
        predicate: "detail",
        value: "Alpha",
        confidence: 0.5,
        salience: 0.5,
      },
    });
    const relationship = await applyFixture({
      candidate: {
        scope: "relationship",
        subject: "Relationship fact",
        predicate: "detail",
        value: "Beta",
        confidence: 0.5,
        salience: 0.5,
        relatedUserIds: ["300", "400"],
        sourceDiscordMessageIds: ["901"],
      },
    });
    const highQuality = await applyFixture({
      candidate: {
        subject: "High quality",
        predicate: "detail",
        value: "Gamma",
        confidence: 1,
        salience: 1,
        sourceDiscordMessageIds: ["902"],
      },
    });
    const lowQuality = await applyFixture({
      candidate: {
        subject: "Low quality",
        predicate: "detail",
        value: "Delta",
        confidence: 0,
        salience: 0,
        sourceDiscordMessageIds: ["903"],
      },
    });
    const old = await applyFixture({
      candidate: {
        subject: "Old fact",
        predicate: "detail",
        value: "Epsilon",
        confidence: 0.5,
        salience: 0.5,
        sourceDiscordMessageIds: ["904"],
      },
    });
    const recent = await applyFixture({
      candidate: {
        subject: "Recent fact",
        predicate: "detail",
        value: "Zeta",
        confidence: 0.5,
        salience: 0.5,
        sourceDiscordMessageIds: ["905"],
      },
    });
    const oldId = old.claims[0]?.id;
    if (oldId === undefined) {
      throw new Error("Expected an old claim");
    }
    await client().memoryClaim.update({
      where: { id: oldId },
      data: { lastConfirmedAt: new Date("2020-01-01T00:00:00.000Z") },
    });

    const retrieved = await retrieveMemoryClaims(client(), {
      guildId: "100",
      userIds: ["300"],
      relationshipUserIds: ["300", "400"],
      query: "unmatched",
      at: new Date("2026-08-08T00:00:00.000Z"),
    });
    const orderedIds = retrieved.claims.map((entry) => entry.claim.id);
    const guildId = guild.claims[0]?.id;
    const relationshipId = relationship.claims[0]?.id;
    const highQualityId = highQuality.claims[0]?.id;
    const lowQualityId = lowQuality.claims[0]?.id;
    const recentId = recent.claims[0]?.id;
    if (
      guildId === undefined ||
      relationshipId === undefined ||
      highQualityId === undefined ||
      lowQualityId === undefined ||
      recentId === undefined
    ) {
      throw new Error("Expected every ranked claim to be created");
    }

    expect(orderedIds.indexOf(relationshipId)).toBeLessThan(
      orderedIds.indexOf(guildId),
    );
    expect(orderedIds.indexOf(highQualityId)).toBeLessThan(
      orderedIds.indexOf(lowQualityId),
    );
    expect(orderedIds.indexOf(recentId)).toBeLessThan(
      orderedIds.indexOf(oldId),
    );
  });

  test("returns at most twelve claims", async () => {
    for (let index = 0; index < 15; index += 1) {
      await applyFixture({
        candidate: {
          subject: `Fact ${String(index)}`,
          predicate: "detail",
          value: `Value ${String(index)}`,
          sourceDiscordMessageIds: [String(1100 + index)],
        },
      });
    }

    const retrieved = await retrieveMemoryClaims(client(), {
      guildId: "100",
      userIds: ["300"],
      query: "facts",
    });
    expect(retrieved.claims).toHaveLength(12);
  });
});

describe("explicit memory lifecycle", () => {
  test("privacy erase follows deterministic claim identity, not shared evidence", async () => {
    const exact = await applyFixture({
      candidate: { sourceDiscordMessageIds: ["910"] },
      embedding: [1, 0],
    });
    const paraphrase = await applyFixture({
      candidate: {
        subject: "Jerred preferences",
        predicate: "drink selection",
        sourceDiscordMessageIds: ["910"],
      },
      embedding: [0, 1],
    });
    const paraphraseClaimId = paraphrase.claims[0]?.id;
    if (paraphraseClaimId === undefined) {
      throw new Error("Expected a paraphrased claim");
    }
    const unrelated = await applyFixture({
      candidate: {
        scope: "relationship",
        subject: "Jerred and Alice",
        predicate: "family relationship",
        value: "siblings",
        relatedUserIds: ["300", "400"],
        sourceDiscordMessageIds: ["910"],
      },
    });
    const unrelatedClaimId = unrelated.claims[0]?.id;
    if (unrelatedClaimId === undefined) {
      throw new Error("Expected an unrelated relationship claim");
    }
    const claimId = exact.claims[0]?.id;
    if (claimId === undefined) {
      throw new Error("Expected an exact memory claim");
    }

    const erased = await privacyEraseMemoryClaim(client(), {
      claimId,
      sourceDiscordMessageId: "911",
    });

    expect(erased.erasedRevisionCount).toBe(1);
    expect(await client().memoryClaim.count()).toBe(2);
    expect(await client().memoryRevision.count()).toBe(2);
    expect(
      await client().memoryClaim.findUnique({
        where: { id: paraphraseClaimId },
      }),
    ).not.toBeNull();
    expect(
      await client().memoryClaim.findUnique({
        where: { id: unrelatedClaimId },
      }),
    ).not.toBeNull();
    expect(
      await client().memorySourceFence.findUnique({
        where: { sourceDiscordMessageId: "910" },
      }),
    ).not.toBeNull();
  });

  test("remembers, inspects, corrects, tombstones, and physically erases", async () => {
    const remembered = await rememberMemoryClaim(client(), {
      context: BASE_CONTEXT,
      candidate: candidate(),
      embedding: [1, 0],
      sourceOrder: "900",
    });
    expect(remembered.claim.status).toBe("active");
    expect(remembered.revisions[0]?.action).toBe("create");

    const corrected = await correctMemoryClaim(client(), {
      claimId: remembered.claim.id,
      value: "tea",
      confidence: 1,
      salience: 0.9,
      validFrom: null,
      validUntil: null,
      sourceDiscordMessageIds: ["901"],
      sourceOrder: "901",
      authorUserId: "300",
      channelId: "200",
      extractorModel: "correction-test",
      embedding: [0, 1],
    });
    expect(corrected.claim.value).toBe("tea");
    expect(corrected.claim.status).toBe("active");
    const oldHistory = await inspectMemoryClaim(client(), {
      claimId: remembered.claim.id,
    });
    expect(oldHistory.claim.status).toBe("superseded");
    expect(oldHistory.revisions.at(-1)?.action).toBe("correction");

    const forgotten = await forgetMemoryClaim(client(), {
      claimId: corrected.claim.id,
      sourceDiscordMessageIds: ["902"],
      authorUserId: "300",
      channelId: "200",
      extractorModel: "explicit-tool",
    });
    expect(forgotten.claim.status).toBe("forgotten");
    expect(forgotten.claim.embedding).toEqual([0, 1]);
    expect(forgotten.claim.sourceDiscordMessageIds).toEqual(["901", "902"]);
    expect(
      await listMemoryClaims(client(), {
        guildId: "100",
        statuses: ["active", "uncertain"],
      }),
    ).toHaveLength(0);

    const erased = await privacyEraseMemoryClaim(client(), {
      claimId: corrected.claim.id,
      sourceDiscordMessageId: "903",
    });
    expect(erased.erasedRevisionCount).toBe(4);
    expect(
      await client().memoryClaim.findUnique({
        where: { id: corrected.claim.id },
      }),
    ).toBeNull();
    expect(
      await client().memoryRevision.count({
        where: { claimId: corrected.claim.id },
      }),
    ).toBe(0);
    expect(await client().memoryExtractionFence.count()).toBe(1);
    expect(await client().memorySourceFence.count()).toBeGreaterThan(0);

    const replayedOldTranscript = await applyEnvelopes([
      {
        candidate: candidate({
          value: "tea",
          sourceDiscordMessageIds: ["901"],
        }),
        embedding: null,
        provenance: {
          authorUserId: BASE_CONTEXT.authorUserId,
          channelId: BASE_CONTEXT.channelId,
          sourceOrder: "901",
        },
      },
    ]);
    expect(replayedOldTranscript.claims).toHaveLength(0);
    expect(await client().memoryClaim.count()).toBe(0);

    const paraphrasedMixedSource = await applyEnvelopes([
      {
        candidate: candidate({
          subject: "Jerred's preferences",
          predicate: "drink choice",
          value: "tea",
          sourceDiscordMessageIds: ["901", "904"],
        }),
        embedding: null,
        provenance: {
          authorUserId: BASE_CONTEXT.authorUserId,
          channelId: BASE_CONTEXT.channelId,
          sourceOrder: "904",
        },
      },
    ]);
    expect(paraphrasedMixedSource.claims).toHaveLength(0);
    expect(await client().memoryClaim.count()).toBe(0);

    const freshStatement = await applyEnvelopes([
      {
        candidate: candidate({
          value: "water",
          sourceDiscordMessageIds: ["905"],
        }),
        embedding: null,
        provenance: {
          authorUserId: BASE_CONTEXT.authorUserId,
          channelId: BASE_CONTEXT.channelId,
          sourceOrder: "905",
        },
      },
    ]);
    expect(freshStatement.claims).toEqual([
      expect.objectContaining({ value: "water", status: "active" }),
    ]);
  });
});

describe("explicit memory persistence failures", () => {
  test("fails loudly when persisted embedding JSON is malformed", async () => {
    const created = await applyFixture({ embedding: [1, 0] });
    const claimId = created.claims[0]?.id;
    if (claimId === undefined) {
      throw new Error("Expected a created claim");
    }
    await client().memoryClaim.update({
      where: { id: claimId },
      data: { embedding: "not-json" },
    });

    await expect(
      retrieveMemoryClaims(client(), {
        guildId: "100",
        userIds: ["300"],
        query: "coffee",
        queryEmbedding: [1, 0],
      }),
    ).rejects.toThrow();
  });

  test("fails loudly when query and stored embedding dimensions differ", async () => {
    await applyFixture({ embedding: [1, 0] });

    await expect(
      retrieveMemoryClaims(client(), {
        guildId: "100",
        userIds: ["300"],
        query: "coffee",
        queryEmbedding: [1, 0, 0],
      }),
    ).rejects.toThrow("dimensions do not match");
  });
});

describe("explicit memory source chronology", () => {
  test("does not let a delayed older remember command supersede newer evidence", async () => {
    const newer = await applyEnvelopes([
      {
        candidate: candidate({
          value: "tea",
          sourceDiscordMessageIds: ["902"],
        }),
        embedding: null,
        provenance: {
          authorUserId: BASE_CONTEXT.authorUserId,
          channelId: BASE_CONTEXT.channelId,
          sourceOrder: "902",
        },
      },
    ]);

    const delayed = await rememberMemoryClaim(client(), {
      context: BASE_CONTEXT,
      candidate: candidate({ sourceDiscordMessageIds: ["901"] }),
      embedding: null,
      sourceOrder: "901",
    });
    const newerClaimId = newer.claims[0]?.id;
    if (newerClaimId === undefined) {
      throw new Error("Expected a newer claim");
    }

    expect(delayed.claim.status).toBe("superseded");
    expect(newer.claims[0]?.status).toBe("active");
    expect(
      await client().memoryClaim.findUniqueOrThrow({
        where: { id: newerClaimId },
      }),
    ).toMatchObject({ status: "active", value: "tea" });
  });

  test("does not let a delayed older correction supersede newer evidence", async () => {
    const original = await applyEnvelopes([
      {
        candidate: candidate({ sourceDiscordMessageIds: ["900"] }),
        embedding: null,
        provenance: {
          authorUserId: BASE_CONTEXT.authorUserId,
          channelId: BASE_CONTEXT.channelId,
          sourceOrder: "900",
        },
      },
    ]);
    const originalClaimId = original.claims[0]?.id;
    if (originalClaimId === undefined) {
      throw new Error("Expected an original claim");
    }
    const newer = await applyEnvelopes([
      {
        candidate: candidate({
          value: "tea",
          sourceDiscordMessageIds: ["902"],
        }),
        embedding: null,
        provenance: {
          authorUserId: BASE_CONTEXT.authorUserId,
          channelId: BASE_CONTEXT.channelId,
          sourceOrder: "902",
        },
      },
    ]);

    const delayed = await correctMemoryClaim(client(), {
      claimId: originalClaimId,
      value: "water",
      confidence: 1,
      salience: 0.9,
      validFrom: null,
      validUntil: null,
      sourceDiscordMessageIds: ["901"],
      sourceOrder: "901",
      authorUserId: BASE_CONTEXT.authorUserId,
      channelId: BASE_CONTEXT.channelId,
      extractorModel: "correction-test",
      embedding: null,
    });
    const newerClaimId = newer.claims[0]?.id;
    if (newerClaimId === undefined) {
      throw new Error("Expected a newer claim");
    }

    expect(delayed.claim).toMatchObject({
      status: "superseded",
      value: "water",
    });
    expect(
      await client().memoryClaim.findUniqueOrThrow({
        where: { id: newerClaimId },
      }),
    ).toMatchObject({ status: "active", value: "tea" });
  });
});
