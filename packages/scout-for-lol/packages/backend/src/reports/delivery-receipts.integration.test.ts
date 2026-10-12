import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  testAccountId,
  testChannelId,
  testGuildId,
} from "#src/testing/test-ids.ts";
import {
  deliverReportChunk,
  freezeReportDelivery,
  ReportDeliveryUnknownError,
} from "#src/reports/delivery-receipts.ts";
import { executeOperationsIntent } from "#src/operations/operations-execution.ts";
import { OperationsIntentPayloadSchema } from "@scout-for-lol/data";

const { prisma } = createTestDatabase("report-delivery-receipts");
beforeEach(async () => {
  await prisma.report.deleteMany();
  await prisma.scoutEffectClaim.deleteMany();
});
afterAll(async () => {
  await prisma.$disconnect();
});

async function dispatch(content = "Frozen report output") {
  const report = await prisma.report.create({
    data: {
      title: "Receipt recovery",
      serverId: testGuildId("91001"),
      channelId: testChannelId("91002"),
      ownerId: testAccountId("91003"),
      queryText: "SELECT games FROM match_participants GROUP BY all",
      cronExpression: "0 0 * * *",
      createdTime: new Date(),
      updatedTime: new Date(),
    },
  });
  const run = await prisma.reportRun.create({
    data: {
      reportId: report.id,
      serverId: report.serverId,
      trigger: "MANUAL",
      status: "SUCCESS",
      startedAt: new Date(),
      renderedContent: content,
      deliveryState: "PENDING",
      deliveryChannelId: report.channelId,
      deliveryServerId: report.serverId,
    },
  });
  return {
    report,
    result: {
      runId: run.id,
      rowsReturned: 1,
      rowsScanned: 1,
      output: { content, image: null },
    },
  };
}

describe("durable report chunk delivery", () => {
  test("freezes the full payload before sending and reuses it on retry", async () => {
    const input = await dispatch("first chunk\n".repeat(400));
    const chunks = await freezeReportDelivery(input, prisma);
    expect(chunks.length).toBeGreaterThan(1);
    const repeated = await freezeReportDelivery(
      {
        ...input,
        result: {
          ...input.result,
          output: { content: "changed output", image: null },
        },
      },
      prisma,
    );
    expect(repeated).toEqual(chunks);
    const send = vi.fn(async () => ({ id: "100000000000000001" }));
    const first = chunks[0];
    if (first === undefined) throw new Error("Missing first chunk");
    await deliverReportChunk(first, send, prisma);
    await deliverReportChunk(first, send, prisma);
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      await prisma.reportDeliveryChunk.findFirstOrThrow({
        where: { reportRunId: input.result.runId },
      }),
    ).toMatchObject({ state: "DELIVERED", messageId: "100000000000000001" });
  });

  test("a lost send response is held and never automatically retried", async () => {
    const [chunk] = await freezeReportDelivery(await dispatch(), prisma);
    if (chunk === undefined) throw new Error("Missing chunk");
    const send = vi.fn(async (): Promise<{ id: string }> => {
      throw new Error("response lost after Discord accepted");
    });
    await expect(
      deliverReportChunk(chunk, send, prisma),
    ).rejects.toBeInstanceOf(ReportDeliveryUnknownError);
    await expect(
      deliverReportChunk(chunk, send, prisma),
    ).rejects.toBeInstanceOf(ReportDeliveryUnknownError);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await prisma.reportDeliveryChunk.findFirstOrThrow()).toMatchObject({
      state: "UNKNOWN",
    });
  });

  test("concurrent observers never send a chunk twice or block the sender's checkpoint", async () => {
    const [chunk] = await freezeReportDelivery(await dispatch(), prisma);
    if (chunk === undefined) throw new Error("Missing chunk");
    const started = Promise.withResolvers<undefined>();
    const accepted = Promise.withResolvers<{ id: string }>();
    const send = vi.fn(async () => {
      started.resolve(undefined);
      return await accepted.promise;
    });
    const original = deliverReportChunk(chunk, send, prisma);
    await started.promise;
    await expect(
      deliverReportChunk(chunk, send, prisma),
    ).rejects.toBeInstanceOf(ReportDeliveryUnknownError);
    accepted.resolve({ id: "100000000000000001" });
    await original;
    expect(send).toHaveBeenCalledTimes(1);
    expect(await prisma.reportDeliveryChunk.findFirstOrThrow()).toMatchObject({
      state: "DELIVERED",
    });
  });

  test("partial delivery resumes remaining chunks without repeating completed ones", async () => {
    const chunks = await freezeReportDelivery(
      await dispatch("Report output\n".repeat(250)),
      prisma,
    );
    const first = chunks[0];
    if (first === undefined || chunks.length < 2)
      throw new Error("Missing multipart output");
    const send = vi.fn(async () => ({ id: "100000000000000001" }));
    await deliverReportChunk(first, send, prisma);
    for (const chunk of chunks) await deliverReportChunk(chunk, send, prisma);
    expect(send).toHaveBeenCalledTimes(chunks.length);
    expect(
      await prisma.reportDeliveryChunk.count({ where: { state: "DELIVERED" } }),
    ).toBe(chunks.length);
  });

  test("a crash after acceptance but before checkpoint never sends again", async () => {
    const [chunk] = await freezeReportDelivery(await dispatch(), prisma);
    if (chunk === undefined) throw new Error("Missing chunk");
    await prisma.reportDeliveryChunk.updateMany({
      data: { state: "SENDING", sendStartedAt: new Date() },
    });
    const send = vi.fn(async () => ({ id: "100000000000000001" }));
    await expect(
      deliverReportChunk(chunk, send, prisma),
    ).rejects.toBeInstanceOf(ReportDeliveryUnknownError);
    expect(send).not.toHaveBeenCalled();
  });

  test("starts every chunk pending and ignores legacy send claims", async () => {
    const input = await dispatch();
    await prisma.scoutEffectClaim.create({
      data: {
        key: `report-discord:${input.result.runId.toString()}:0`,
        kind: "report-discord",
        state: "COMPLETED",
      },
    });
    const [chunk] = await freezeReportDelivery(input, prisma);
    if (chunk === undefined) throw new Error("Missing chunk");
    expect(chunk).toMatchObject({
      state: "PENDING",
      messageId: null,
      deliveredAt: null,
      lastError: null,
    });
  });

  test("freezes a run already recorded as delivered without another send", async () => {
    const input = await dispatch();
    const deliveredAt = new Date("2026-10-01T12:00:00.000Z");
    await prisma.reportRun.update({
      where: { id: input.result.runId },
      data: { deliveryState: "DELIVERED", deliveredAt },
    });
    const [chunk] = await freezeReportDelivery(input, prisma);
    if (chunk === undefined) throw new Error("Missing chunk");
    expect(chunk).toMatchObject({ state: "DELIVERED", deliveredAt });
    const send = vi.fn(async () => ({ id: "100000000000000001" }));
    await deliverReportChunk(chunk, send, prisma);
    expect(send).not.toHaveBeenCalled();
  });

  test("an operator releases only the investigated nonce and chunk", async () => {
    const input = await dispatch();
    const [chunk] = await freezeReportDelivery(input, prisma);
    if (chunk === undefined) throw new Error("Missing chunk");
    await prisma.reportDeliveryChunk.updateMany({ data: { state: "UNKNOWN" } });
    const payload = OperationsIntentPayloadSchema.parse({
      kind: "ops_resolve_report_delivery",
      version: 1,
      runId: chunk.reportRunId,
      channelId: chunk.channelId,
      chunkIndex: chunk.chunkIndex,
      attemptNonce: chunk.nonce,
      answer: { outcome: "not-delivered" },
    });
    const executed = await prisma.$transaction(
      async (tx) =>
        await executeOperationsIntent(tx, { payload, now: new Date() }),
    );
    expect(executed.outcome).toMatchObject({
      kind: "report-delivery-resolved",
      state: "PENDING",
    });
    const released = await prisma.reportDeliveryChunk.findFirstOrThrow();
    expect(released.nonce).not.toBe(chunk.nonce);
    const repeated = await prisma.$transaction(
      async (tx) =>
        await executeOperationsIntent(tx, { payload, now: new Date() }),
    );
    expect(repeated.outcome).toEqual({
      kind: "machine-refused",
      reason: "stale-operator-view",
    });
  });

  test("simultaneous chunk resolutions leave the occurrence resumable", async () => {
    const input = await dispatch("Report output\n".repeat(250));
    const chunks = await freezeReportDelivery(input, prisma);
    expect(chunks.length).toBeGreaterThan(1);
    await prisma.reportDeliveryChunk.updateMany({ data: { state: "UNKNOWN" } });
    await prisma.reportRun.update({
      where: { id: input.result.runId },
      data: { deliveryState: "UNKNOWN" },
    });
    await Promise.all(
      chunks.map(async (chunk) => {
        const payload = OperationsIntentPayloadSchema.parse({
          kind: "ops_resolve_report_delivery",
          version: 1,
          runId: chunk.reportRunId,
          channelId: chunk.channelId,
          chunkIndex: chunk.chunkIndex,
          attemptNonce: chunk.nonce,
          answer: { outcome: "not-delivered" },
        });
        await prisma.$transaction(
          async (tx) =>
            await executeOperationsIntent(tx, { payload, now: new Date() }),
        );
      }),
    );
    expect(
      await prisma.reportRun.findUniqueOrThrow({
        where: { id: input.result.runId },
      }),
    ).toMatchObject({ deliveryState: "PENDING" });
    expect(
      await prisma.reportDeliveryChunk.count({ where: { state: "PENDING" } }),
    ).toBe(chunks.length);
  });
});
