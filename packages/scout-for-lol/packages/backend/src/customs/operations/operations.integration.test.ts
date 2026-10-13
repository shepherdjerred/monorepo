import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  testAccountId,
  testChannelId,
  testPuuid,
} from "#src/testing/test-ids.ts";
import { mutateCustomNight } from "#src/customs/repository.ts";
import { buildCustomNightSnapshot } from "#src/customs/snapshot.ts";
import { clearCustomsTestData } from "#src/customs/test-database.ts";
import { commitCustomOperation } from "#src/customs/operations/request.ts";
import { executeCustomOperationWithPort } from "#src/customs/operations/execution.ts";
import {
  seedCustomOperation,
  customVoicePortFixture as port,
} from "#src/customs/operations/operations.test-fixtures.ts";
import {
  CustomOperationProgressSchema,
  CustomOperationPayloadSchema,
} from "#src/customs/operations/contracts.ts";
import { findPendingCustomWork } from "#src/customs/operations/reconciliation.ts";
import { commitCustomVoiceResolution } from "#src/customs/operations/resolution.ts";
import { customTeamChannelName } from "#src/customs/operations/channel-name.ts";
import { anonymizeCustomOperationSnapshots } from "#src/customs/operations/anonymize.ts";

const { prisma: db } = createTestDatabase("customs-durable-operations");
const hostId = testAccountId("8500");
const now = new Date();
beforeEach(async () => {
  await clearCustomsTestData(db);
  await db.scoutWorkflowStart.deleteMany();
});

test("terminal frozen operation snapshots follow participant anonymization", async () => {
  const seeded = await seed("end");
  await executeCustomOperationWithPort(db, seeded.operationId, async () =>
    port(),
  );
  const original = testAccountId("8510");
  const pseudonym = testAccountId("8999");
  await db.$transaction(
    async (tx) =>
      await anonymizeCustomOperationSnapshots(tx, {
        nightIds: [seeded.snapshot.id],
        original,
        pseudonym,
        playerId: 1_000_000_001,
        accountId: 1_000_000_002,
        puuid: testPuuid("8999"),
      }),
  );
  const stored = await db.customNightOperation.findUniqueOrThrow({
    where: { id: seeded.operationId },
  });
  expect(stored.payload).not.toContain(original);
  expect(stored.payload).toContain(pseudonym);
  expect(stored.state).toBe("completed");
});
afterAll(async () => {
  await db.$disconnect();
});

async function seed(action: "arrange" | "end" = "arrange") {
  return await seedCustomOperation(db, hostId, now, action);
}

describe("Customs durable operation boundaries", () => {
  test("one revision commits one operation and its recoverable start, while conflicting mutations are fenced", async () => {
    const seeded = await seed();
    await commitCustomOperation(db, seeded.snapshot, {
      actorDiscordId: hostId,
      action: "arrange",
      input: seeded.input,
      now,
    });
    expect(await db.customNightOperation.count()).toBe(1);
    expect(await db.scoutWorkflowStart.count()).toBe(1);
    const pendingWork = await findPendingCustomWork(db);
    expect(pendingWork.customOperations).toEqual([seeded.operationId]);
    await expect(
      mutateCustomNight(db, {
        nightId: seeded.snapshot.id,
        expectedRevision: 1,
        actorId: hostId,
        action: "NIGHT_PREPARING",
        payload: {},
        source: "ACTIVITY",
        now,
      }),
    ).rejects.toThrow("stale or ended");
    const snapshot = await buildCustomNightSnapshot(
      db,
      seeded.snapshot.id,
      hostId,
    );
    expect(snapshot?.pendingOperation).toMatchObject({
      state: "queued",
      action: "arrange",
    });
  });

  test("a restart resumes recorded channels and moves without creating replacements", async () => {
    const seeded = await seed();
    const voice = port();
    voice.move
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(async () => {
        throw new Error("Injected move interruption");
      });
    await expect(
      executeCustomOperationWithPort(db, seeded.operationId, async () => voice),
    ).rejects.toThrow("Injected move interruption");
    expect(voice.createTeam).toHaveBeenCalledTimes(2);
    const partial = await db.customNight.findUniqueOrThrow({
      where: { id: seeded.snapshot.id },
    });
    expect(partial).toMatchObject({
      teamAVoiceChannelId: testChannelId("8601"),
      teamBVoiceChannelId: testChannelId("8602"),
    });
    await expect(
      executeCustomOperationWithPort(db, seeded.operationId, async () => voice),
    ).resolves.toMatchObject({ state: "completed" });
    expect(voice.createTeam).toHaveBeenCalledTimes(2);
    expect(
      voice.move.mock.calls.filter(([id]) => id === testAccountId("8510")),
    ).toHaveLength(1);
    const game = await db.customGame.findUniqueOrThrow({
      where: { id: seeded.gameId },
    });
    expect(game.voiceReady).toBe(true);
    const never = vi.fn(async () => voice);
    await executeCustomOperationWithPort(db, seeded.operationId, never);
    expect(never).not.toHaveBeenCalled();
  });

  test("an uncertain channel creation holds for inspection and cannot automatically create another", async () => {
    const seeded = await seed();
    const voice = port();
    voice.createTeam.mockRejectedValueOnce(
      new Error("Creation acknowledgement lost"),
    );
    await expect(
      executeCustomOperationWithPort(db, seeded.operationId, async () => voice),
    ).resolves.toMatchObject({ state: "held" });
    await executeCustomOperationWithPort(
      db,
      seeded.operationId,
      async () => voice,
    );
    expect(voice.createTeam).toHaveBeenCalledTimes(1);
    const snapshot = await buildCustomNightSnapshot(
      db,
      seeded.snapshot.id,
      hostId,
    );
    const pending = snapshot?.pendingOperation;
    expect(pending).toMatchObject({ state: "held" });
    expect(pending?.step).toContain("confirmation");
  });

  test("a process lost between channel creation and PG receipt holds even without an Activity failure answer", async () => {
    const seeded = await seed();
    const standing = await db.customNightOperation.findUniqueOrThrow({
      where: { id: seeded.operationId },
    });
    const progress = CustomOperationProgressSchema.parse(
      JSON.parse(standing.progress),
    );
    progress.creating = "A";
    await db.customNightOperation.update({
      where: { id: seeded.operationId },
      data: { state: "running", progress: JSON.stringify(progress) },
    });
    const makePort = vi.fn(async () => port());
    await expect(
      executeCustomOperationWithPort(db, seeded.operationId, makePort),
    ).resolves.toMatchObject({ state: "held" });
    expect(makePort).not.toHaveBeenCalled();
  });
});

describe("Customs operation recovery and resolution", () => {
  test("a partial cleanup resumes recorded deletions and commits one frozen next game", async () => {
    const seeded = await seed();
    const voice = port();
    await executeCustomOperationWithPort(
      db,
      seeded.operationId,
      async () => voice,
    );
    await db.customGame.update({
      where: { id: seeded.gameId },
      data: { state: "VERIFIED" },
    });
    await db.customNight.update({
      where: { id: seeded.snapshot.id },
      data: { state: "INTERMISSION" },
    });
    const snapshot = await buildCustomNightSnapshot(
      db,
      seeded.snapshot.id,
      hostId,
    );
    if (snapshot === undefined) throw new Error("Expected intermission");
    const operationId = await commitCustomOperation(db, snapshot, {
      actorDiscordId: hostId,
      action: "continue",
      now,
      input: {
        nightId: snapshot.id,
        expectedRevision: snapshot.revision,
        choice: "KEEP_TEAMS_REROLL_CAPTAINS",
      },
    });
    const operation = await db.customNightOperation.findUniqueOrThrow({
      where: { id: operationId },
    });
    const payload = CustomOperationPayloadSchema.parse(
      JSON.parse(operation.payload),
    );
    voice.deleteChannel
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Delete interrupted"));
    await expect(
      executeCustomOperationWithPort(db, operationId, async () => voice),
    ).rejects.toThrow("Delete interrupted");
    expect(await db.customGame.count()).toBe(1);
    await executeCustomOperationWithPort(db, operationId, async () => voice);
    await executeCustomOperationWithPort(db, operationId, async () => voice);
    expect(voice.deleteChannel.mock.calls).toEqual([
      [testChannelId("8601")],
      [testChannelId("8602")],
      [testChannelId("8602")],
    ]);
    expect(await db.customGame.count()).toBe(2);
    const current = await buildCustomNightSnapshot(db, snapshot.id, hostId);
    expect(current?.currentGame?.id).toBe(payload.nextGame?.id);
    expect(current?.currentGame?.participants).toEqual(
      payload.nextGame?.participants,
    );
    expect(current?.pendingOperation).toBeNull();
  });
});

describe("Customs operation exclusion and resolution", () => {
  test("concurrent Activity attempts share the database fence through the final effect", async () => {
    const seeded = await seed();
    const voice = port();
    let release: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      voice.move.mockImplementationOnce(async () => {
        resolve();
        await new Promise<void>((done) => {
          release = done;
        });
      });
    });
    const first = executeCustomOperationWithPort(
      db,
      seeded.operationId,
      async () => voice,
    );
    await entered;
    const second = executeCustomOperationWithPort(
      db,
      seeded.operationId,
      async () => voice,
    );
    if (release === undefined) throw new Error("Expected paused move");
    release();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { nightId: seeded.snapshot.id, state: "completed" },
      { nightId: seeded.snapshot.id, state: "completed" },
    ]);
    expect(voice.createTeam).toHaveBeenCalledTimes(2);
    expect(voice.move).toHaveBeenCalledTimes(10);
  });

  test("ending releases the active guild and preserves a readable terminal snapshot", async () => {
    const seeded = await seed("end");
    await executeCustomOperationWithPort(db, seeded.operationId, async () =>
      port(),
    );
    expect(await db.customActiveNight.count()).toBe(0);
    expect(
      await buildCustomNightSnapshot(db, seeded.snapshot.id, hostId),
    ).toMatchObject({
      state: "ENDED",
      currentGame: { state: "VOID", voiceState: "CLEANED_UP" },
      pendingOperation: null,
    });
  });

  test("a manager can adopt a confirmed created channel and resume without recreating it", async () => {
    const seeded = await seed();
    const voice = port();
    voice.createTeam.mockRejectedValueOnce(new Error("Acknowledgement lost"));
    await executeCustomOperationWithPort(
      db,
      seeded.operationId,
      async () => voice,
    );
    const night = await db.customNight.findUniqueOrThrow({
      where: { id: seeded.snapshot.id },
    });
    const channelId = testChannelId("8601");
    const input = {
      nightId: night.id,
      expectedRevision: night.revision,
      operationId: seeded.operationId,
      evidence:
        "Checked the server's current voice channels and this is Team A.",
      answer: { kind: "channel-created" as const, channelId },
    };
    const channels = [
      {
        id: channelId,
        name: customTeamChannelName(seeded.operationId, 1, "A"),
        type: 2,
        permission_overwrites: [],
      },
    ];
    await expect(
      commitCustomVoiceResolution(
        db,
        { ...input, answer: { kind: "confirmed-unsent" } },
        hostId,
        async () => channels,
      ),
    ).rejects.toThrow("matching team channel exists");
    const operation = await db.customNightOperation.findUniqueOrThrow({
      where: { id: seeded.operationId },
    });
    expect(operation.state).toBe("held");
    await commitCustomVoiceResolution(db, input, hostId, async () => channels);
    await executeCustomOperationWithPort(
      db,
      seeded.operationId,
      async () => voice,
    );
    expect(voice.createTeam.mock.calls).toEqual([["A"], ["B"]]);
    expect(
      await db.customAuditEvent.count({
        where: { action: "OPERATION_CREATION_RESOLVED" },
      }),
    ).toBe(1);
  });

  test("confirmed absence permits another creation, while missing server evidence does not", async () => {
    const seeded = await seed();
    const voice = port();
    voice.createTeam.mockRejectedValueOnce(
      new Error("Request never reached Discord"),
    );
    await executeCustomOperationWithPort(
      db,
      seeded.operationId,
      async () => voice,
    );
    const night = await db.customNight.findUniqueOrThrow({
      where: { id: seeded.snapshot.id },
    });
    const input = {
      nightId: night.id,
      expectedRevision: night.revision,
      operationId: seeded.operationId,
      evidence:
        "Checked the complete fresh channel list; no matching channel exists.",
      answer: { kind: "confirmed-unsent" as const },
    };
    await expect(
      commitCustomVoiceResolution(db, input, hostId, async () => null),
    ).rejects.toThrow("cannot inspect");
    await commitCustomVoiceResolution(db, input, hostId, async () => []);
    await executeCustomOperationWithPort(
      db,
      seeded.operationId,
      async () => voice,
    );
    expect(voice.createTeam.mock.calls).toEqual([["A"], ["A"], ["B"]]);
  });

  test("cancellation after creation records its receipt before stopping and can resume safely", async () => {
    const seeded = await seed();
    const voice = port();
    const cancellation = new AbortController();
    voice.createTeam.mockImplementationOnce(async () => {
      cancellation.abort(new Error("Activity cancelled"));
      return testChannelId("8601");
    });
    await expect(
      executeCustomOperationWithPort(
        db,
        seeded.operationId,
        async () => voice,
        cancellation.signal,
      ),
    ).rejects.toThrow("Activity cancelled");
    const operation = await db.customNightOperation.findUniqueOrThrow({
      where: { id: seeded.operationId },
    });
    expect(
      CustomOperationProgressSchema.parse(JSON.parse(operation.progress)),
    ).toMatchObject({ creating: null, channels: { A: testChannelId("8601") } });
    await executeCustomOperationWithPort(
      db,
      seeded.operationId,
      async () => voice,
    );
    expect(voice.createTeam.mock.calls).toEqual([["A"], ["B"]]);
  });
});
