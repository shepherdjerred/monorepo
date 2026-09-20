import { beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod/v4";
const mocks = vi.hoisted(() => ({ request: vi.fn(), config: vi.fn() }));
vi.mock("#lib/bluebubbles/client.ts", () => ({
  blueBubblesRequest: mocks.request,
}));
vi.mock("#config/imessage.ts", () => ({ imessageIngressConfig: mocks.config }));
import { pollBlueBubblesMessages } from "./poll.ts";

const CURSOR = {
  startedAt: "2026-09-17T00:00:00.000Z",
  initialized: true,
  lastRowId: 10,
};
const message = (row: number) => ({
  originalROWID: row,
  guid: `guid-${row.toString()}`,
  dateCreated: Date.parse(CURSOR.startedAt) + row,
  isFromMe: false,
  text: "hello",
  handle: { address: "owner" },
  itemType: 0,
  associatedMessageType: null,
  chats: [{ guid: "dm", style: 45 }],
});
const QueryBodySchema = z.object({
  where: z.array(z.object({ args: z.record(z.string(), z.number()) })),
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.config.mockResolvedValue({ enabled: true, owners: ["owner"] });
});
describe("durable BlueBubbles polling", () => {
  test("uses a stable ROWID cursor, sorts before paging and retains disallowed rows in progress", async () => {
    mocks.request.mockResolvedValue([
      message(13),
      { ...message(12), isFromMe: true },
      message(11),
    ]);
    expect(await pollBlueBubblesMessages(CURSOR)).toMatchObject({
      lastRowId: 13,
      commands: [{ messageId: "guid-11" }, { messageId: "guid-13" }],
    });
    expect(mocks.request).toHaveBeenCalledWith(
      "/api/v1/message/query",
      expect.objectContaining({
        where: [{ statement: "message.ROWID > :cursor", args: { cursor: 10 } }],
      }),
    );
    expect(mocks.request.mock.calls[0]?.[1]).not.toHaveProperty("after");
  });
  test("establishes an initial ROWID watermark without replaying history", async () => {
    mocks.request.mockImplementation(async (_route: string, body: unknown) => {
      const input = QueryBodySchema.parse(body);
      const minimumRowId = input.where[0]?.args["minimumRowId"];
      if (minimumRowId !== undefined)
        return minimumRowId <= 75 ? [message(75)] : [];
      return [message(50), message(75), message(60)];
    });
    const result = await pollBlueBubblesMessages({
      ...CURSOR,
      initialized: false,
      lastRowId: 0,
    });
    expect(result).toEqual({
      startedAt: CURSOR.startedAt,
      initialized: true,
      lastRowId: 75,
      commands: [],
    });
    expect(mocks.request).toHaveBeenLastCalledWith("/api/v1/message/query", {
      with: ["chats"],
      limit: 1000,
      sort: "DESC",
      where: [
        { statement: "message.ROWID > :cursor", args: { cursor: 0 } },
        {
          statement: "message.ROWID <= :initializationHighWater",
          args: { initializationHighWater: 75 },
        },
      ],
    });
  });
  test("freezes initialization before admitting messages that arrive during it", async () => {
    mocks.request.mockImplementation(async (_route: string, body: unknown) => {
      const input = QueryBodySchema.parse(body);
      const minimumRowId = input.where[0]?.args["minimumRowId"];
      if (minimumRowId !== undefined)
        return minimumRowId <= 1000 ? [message(1000)] : [];
      const cursor = input.where[0]?.args["cursor"];
      if (cursor === 0)
        return Array.from({ length: 1000 }, (_, index) => message(index + 1));
      if (cursor === 1000 && input.where.length === 2) return [];
      return [message(1001)];
    });

    const first = await pollBlueBubblesMessages({
      ...CURSOR,
      initialized: false,
      lastRowId: 0,
    });
    expect(first).toMatchObject({
      initialized: false,
      lastRowId: 1000,
      initializationHighWaterRowId: 1000,
    });
    if (first.initialized)
      throw new Error("Expected initialization checkpoint");

    const initialized = await pollBlueBubblesMessages({
      startedAt: first.startedAt,
      initialized: first.initialized,
      lastRowId: first.lastRowId,
      initializationHighWaterRowId: first.initializationHighWaterRowId,
    });

    expect(initialized).toEqual({
      startedAt: CURSOR.startedAt,
      initialized: true,
      lastRowId: 1000,
      commands: [],
    });
    expect(mocks.request).toHaveBeenLastCalledWith(
      "/api/v1/message/query",
      expect.objectContaining({
        where: [
          { statement: "message.ROWID > :cursor", args: { cursor: 1000 } },
          {
            statement: "message.ROWID <= :initializationHighWater",
            args: { initializationHighWater: 1000 },
          },
        ],
      }),
    );

    const live = await pollBlueBubblesMessages({
      startedAt: initialized.startedAt,
      initialized: initialized.initialized,
      lastRowId: initialized.lastRowId,
    });
    expect(live).toMatchObject({
      initialized: true,
      lastRowId: 1001,
      commands: [{ messageId: "guid-1001" }],
    });
  });
  test("caps the durable batch at fifty without skipping the remainder", async () => {
    mocks.request.mockResolvedValue(
      Array.from({ length: 60 }, (_, index) =>
        message(index + 11),
      ).toReversed(),
    );
    const result = await pollBlueBubblesMessages(CURSOR);
    expect(result.lastRowId).toBe(60);
    expect(result.commands).toHaveLength(50);
  });
  test("processes the first message after an empty initialization", async () => {
    mocks.request.mockResolvedValue([message(1)]);

    const result = await pollBlueBubblesMessages({
      ...CURSOR,
      initialized: true,
      lastRowId: 0,
    });

    expect(result).toMatchObject({
      initialized: true,
      lastRowId: 1,
      commands: [{ messageId: "guid-1" }],
    });
  });
  test("fails a full time-sorted page without advancing past unseen ROWIDs", async () => {
    mocks.request.mockResolvedValue(
      Array.from({ length: 1000 }, (_, index) => message(index + 11)),
    );
    await expect(pollBlueBubblesMessages(CURSOR)).rejects.toMatchObject({
      message:
        "BlueBubbles backlog exceeds 999 messages; cursor was not advanced",
      nonRetryable: true,
      type: "BlueBubblesBacklogExceeded",
    });
  });
  test("fails a stale initialization page without retrying forever", async () => {
    mocks.request.mockResolvedValue([message(10)]);

    await expect(
      pollBlueBubblesMessages({ ...CURSOR, initialized: false }),
    ).rejects.toMatchObject({
      message: "BlueBubbles initialization did not advance its ROWID",
      nonRetryable: true,
      type: "BlueBubblesInitializationDidNotAdvance",
    });
  });
  test("fails a stale cursor page without retrying forever", async () => {
    mocks.request.mockResolvedValue([message(10)]);

    await expect(pollBlueBubblesMessages(CURSOR)).rejects.toMatchObject({
      message: "BlueBubbles returned a message outside the cursor query",
      nonRetryable: true,
      type: "BlueBubblesCursorQueryViolated",
    });
  });
  test.each([{ handle: {} }, { dateCreated: 253_402_300_800_000 }])(
    "fails malformed messages without retrying the same cursor forever: %j",
    async (invalid) => {
      mocks.request.mockResolvedValue([{ ...message(11), ...invalid }]);

      await expect(pollBlueBubblesMessages(CURSOR)).rejects.toMatchObject({
        message:
          "BlueBubbles returned an invalid message payload; cursor was not advanced",
        nonRetryable: true,
        type: "BlueBubblesInvalidMessagePayload",
      });
    },
  );
  test.each([
    { enabled: false, owners: ["owner"] },
    { enabled: true, owners: [] },
  ])("advances the watermark when disabled or unowned", async (config) => {
    mocks.config.mockResolvedValue(config);
    mocks.request.mockResolvedValue([message(50), message(75)]);
    const result = await pollBlueBubblesMessages(CURSOR);
    expect(result).toMatchObject({
      lastRowId: 75,
      commands: [],
    });
    expect(result.startedAt).toBe(CURSOR.startedAt);
    expect(mocks.request).toHaveBeenCalledWith(
      "/api/v1/message/query",
      expect.objectContaining({
        where: [{ statement: "message.ROWID > :cursor", args: { cursor: 10 } }],
      }),
    );
  });
  test("never moves the disabled watermark backwards", async () => {
    mocks.config.mockResolvedValue({ enabled: false, owners: ["owner"] });
    mocks.request.mockResolvedValue([]);

    const result = await pollBlueBubblesMessages(CURSOR);

    expect(result.lastRowId).toBe(CURSOR.lastRowId);
  });
});
