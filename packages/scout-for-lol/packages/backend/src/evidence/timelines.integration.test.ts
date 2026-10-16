import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { RawMatchSchema, type RawTimeline } from "@scout-for-lol/data";
import {
  createTestDatabase,
  testDatabaseModule,
} from "#src/testing/test-database.ts";
import { RiotTransportError } from "#src/league/api/client/errors.ts";

const { prisma } = createTestDatabase("artifact-timeline-resolution");
const io = vi.hoisted(() => {
  const frozen: { value: RawTimeline | null } = { value: null };
  return {
    riot: vi.fn<() => Promise<RawTimeline | undefined>>(),
    clients: vi.fn<
      () => Promise<{ observationId: string; timeline: RawTimeline }[]>
    >(async () => []),
    frozen,
    persist: vi.fn(async () => true),
  };
});
vi.mock("#src/database/index.ts", async () => await testDatabaseModule(prisma));
vi.mock("#src/configuration/flags.ts", async (original) => ({
  ...(await original()),
  isFeatureHardDisabled: () => false,
}));
vi.mock("#src/league/tasks/postmatch/match-data-fetcher.ts", () => ({
  fetchMatchTimeline: io.riot,
}));
vi.mock("#src/scout-client/canonical-match.ts", async (original) => ({
  ...(await original()),
  readClientTimelineCandidates: io.clients,
  readFrozenTimeline: () => Promise.resolve(io.frozen.value),
}));
vi.mock("#src/report-store/live-ingest.ts", () => ({
  recordTimelineForReportStore: io.persist,
}));
const { admitMatchEvidence } = await import("./admission.ts");
const { resolveMatchTimeline } = await import("./timelines.ts");
const match = RawMatchSchema.parse(
  await Bun.file(
    new URL("../../../../testdata/rift.json", import.meta.url),
  ).json(),
);

function timeline(source: "2" | "local-1"): RawTimeline {
  return {
    metadata: {
      dataVersion: source,
      matchId: match.metadata.matchId,
      participants: match.metadata.participants,
    },
    info: {
      frameInterval: 60_000,
      frames: [],
      gameId: match.info.gameId,
      participants: match.info.participants.map(({ participantId, puuid }) => ({
        participantId,
        puuid,
      })),
    },
  };
}
beforeEach(async () => {
  await prisma.matchEvidenceAdmission.deleteMany();
  await prisma.matchObservation.deleteMany();
  io.riot.mockReset();
  io.clients.mockReset();
  io.clients.mockResolvedValue([]);
  io.persist.mockReset();
  io.persist.mockResolvedValue(true);
  io.frozen.value = null;
  await admitMatchEvidence({
    matchId: match.metadata.matchId,
    completedAt: Date.now(),
    historical: false,
  });
});
afterAll(async () => {
  await prisma.$disconnect();
});
const request = { match, players: [], persistence: "required" as const };

test("a Riot result can use a client timeline during an expected Riot outage", async () => {
  const client = timeline("local-1");
  io.riot.mockRejectedValue(
    new RiotTransportError("fixture-timeline", new Error("network")),
  );
  io.clients.mockResolvedValue([{ observationId: "local", timeline: client }]);
  expect(await resolveMatchTimeline(request)).toMatchObject({
    kind: "available",
    value: client,
  });
  expect(io.riot).toHaveBeenCalledOnce();
  expect(io.clients).toHaveBeenCalledOnce();
  expect(io.persist).toHaveBeenCalledOnce();
});

test("a client result can use Riot's timeline, and Riot wins overlap", async () => {
  const riot = timeline("2");
  io.riot.mockResolvedValue(riot);
  io.clients.mockResolvedValue([
    { observationId: "local", timeline: timeline("local-1") },
  ]);
  const localMatch = RawMatchSchema.parse({
    ...match,
    metadata: { ...match.metadata, dataVersion: "local-1" },
  });
  expect(
    await resolveMatchTimeline({ ...request, match: localMatch }),
  ).toMatchObject({ kind: "available", value: riot });
});

test("the two-minute deadline survives retries and freezes missing coverage", async () => {
  const first = await resolveMatchTimeline(request);
  expect(first.kind).toBe("pending");
  const before = await prisma.matchEvidenceAdmission.findUniqueOrThrow({
    where: { riotMatchId: match.metadata.matchId },
  });
  expect(first).toEqual(await resolveMatchTimeline(request));
  const retried = await prisma.matchEvidenceAdmission.findUniqueOrThrow({
    where: { riotMatchId: match.metadata.matchId },
  });
  expect(retried.timelineDeadlineAt).toEqual(before.timelineDeadlineAt);
  await prisma.matchEvidenceAdmission.update({
    where: { riotMatchId: match.metadata.matchId },
    data: { timelineDeadlineAt: new Date(Date.now() - 1) },
  });
  expect(await resolveMatchTimeline(request)).toMatchObject({
    kind: "unavailable",
  });
  io.clients.mockResolvedValue([
    { observationId: "late", timeline: timeline("local-1") },
  ]);
  expect(await resolveMatchTimeline(request)).toMatchObject({
    kind: "unavailable",
  });
  expect(io.persist).not.toHaveBeenCalled();
  expect(
    await resolveMatchTimeline({ ...request, purpose: "history" }),
  ).toMatchObject({ kind: "available" });
  const recovered = await prisma.matchEvidenceAdmission.findUniqueOrThrow({
    where: { riotMatchId: match.metadata.matchId },
  });
  expect(recovered.timelineMissing).toBe(true);
});

test("the final deadline poll reads durable client evidence before pinning absence", async () => {
  expect(await resolveMatchTimeline(request)).toMatchObject({
    kind: "pending",
  });
  io.riot.mockClear();
  io.clients.mockClear();
  const client = timeline("local-1");
  io.clients.mockResolvedValue([
    { observationId: "arrived-before-deadline", timeline: client },
  ]);
  await prisma.matchEvidenceAdmission.update({
    where: { riotMatchId: match.metadata.matchId },
    data: { timelineDeadlineAt: new Date(Date.now() - 1) },
  });
  expect(await resolveMatchTimeline(request)).toMatchObject({
    kind: "available",
    value: client,
  });
  expect(io.clients).toHaveBeenCalledOnce();
  expect(io.riot).not.toHaveBeenCalled();
  expect(io.persist).toHaveBeenCalledOnce();
  expect(
    await prisma.matchEvidenceAdmission.findUniqueOrThrow({
      where: { riotMatchId: match.metadata.matchId },
    }),
  ).toMatchObject({
    timelineMissing: false,
    timelineFinalizedAt: expect.any(Date),
  });
});

test.each(["P2024", "ECONNRESET"])(
  "a final-poll %s read failure retries before pinning absence",
  async (code) => {
    const deadline = new Date(Date.now() - 1);
    await prisma.matchEvidenceAdmission.update({
      where: { riotMatchId: match.metadata.matchId },
      data: { timelineDeadlineAt: deadline },
    });
    const failure = Object.assign(
      new Error("Persisted timeline temporarily unreadable"),
      { code },
    );
    io.clients.mockRejectedValueOnce(failure);
    await expect(resolveMatchTimeline(request)).rejects.toBe(failure);
    expect(
      await prisma.matchEvidenceAdmission.findUniqueOrThrow({
        where: { riotMatchId: match.metadata.matchId },
      }),
    ).toMatchObject({
      timelineMissing: false,
      timelineFinalizedAt: null,
      timelineDeadlineAt: deadline,
    });
    expect(io.persist).not.toHaveBeenCalled();
    io.clients.mockResolvedValue([
      {
        observationId: "persisted-before-deadline",
        timeline: timeline("local-1"),
      },
    ]);
    expect(await resolveMatchTimeline(request)).toMatchObject({
      kind: "available",
    });
    expect(io.riot).not.toHaveBeenCalled();
  },
);

test("a healthy Riot timeline survives an expected client read outage", async () => {
  io.riot.mockResolvedValue(timeline("2"));
  io.clients.mockRejectedValue(
    Object.assign(new Error("Client pool busy"), { code: "P2024" }),
  );
  expect(await resolveMatchTimeline(request)).toMatchObject({
    kind: "available",
    value: timeline("2"),
  });
});

test("a broken durable contract is not hidden by a healthy Riot source", async () => {
  io.riot.mockResolvedValue(timeline("2"));
  const failure = new Error("Corrupt persisted timeline contract");
  io.clients.mockRejectedValue(failure);
  await expect(resolveMatchTimeline(request)).rejects.toBe(failure);
  expect(io.persist).not.toHaveBeenCalled();
});

test("storage failure retries instead of becoming missing coverage", async () => {
  io.riot.mockResolvedValue(timeline("2"));
  io.persist.mockResolvedValue(false);
  await expect(resolveMatchTimeline(request)).rejects.toThrow(
    "persistence failed",
  );
  const pending = await prisma.matchEvidenceAdmission.findUniqueOrThrow({
    where: { riotMatchId: match.metadata.matchId },
  });
  expect(pending.timelineFinalizedAt).toBeNull();
});

test("a frozen timeline is reused without querying either source", async () => {
  io.frozen.value = timeline("local-1");
  expect(await resolveMatchTimeline(request)).toMatchObject({
    kind: "available",
    frozen: true,
    value: io.frozen.value,
  });
  expect(io.riot).not.toHaveBeenCalled();
  expect(io.clients).not.toHaveBeenCalled();
});

test("an archived timeline still retries a failed required lake projection", async () => {
  io.frozen.value = timeline("2");
  io.persist.mockResolvedValueOnce(false);
  await expect(resolveMatchTimeline(request)).rejects.toThrow(
    "persistence failed",
  );
  expect(await resolveMatchTimeline(request)).toMatchObject({
    kind: "available",
    frozen: true,
  });
  expect(io.persist).toHaveBeenCalledTimes(2);
  expect(io.riot).not.toHaveBeenCalled();
  expect(io.clients).not.toHaveBeenCalled();
});

test("optional report persistence retains best-effort behavior", async () => {
  io.riot.mockResolvedValue(timeline("2"));
  io.persist.mockRejectedValue(new Error("Optional object-store write failed"));
  expect(
    await resolveMatchTimeline({ ...request, persistence: "best_effort" }),
  ).toMatchObject({ kind: "available", frozen: false });
});

test("participant drift and internal failures are never optional outages", async () => {
  io.riot.mockResolvedValue({
    ...timeline("2"),
    info: { ...timeline("2").info, participants: [] },
  });
  await expect(resolveMatchTimeline(request)).rejects.toThrow(
    "participant identities disagree",
  );
  io.riot.mockRejectedValue(new Error("Corrupt persisted contract"));
  await expect(resolveMatchTimeline(request)).rejects.toThrow(
    "Corrupt persisted contract",
  );
});
