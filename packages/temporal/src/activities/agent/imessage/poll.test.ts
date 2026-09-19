import { beforeEach, describe, expect, test, vi } from "vitest";
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
    mocks.request.mockResolvedValue([message(50), message(75), message(60)]);
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
    expect(mocks.request).toHaveBeenCalledWith("/api/v1/message/query", {
      with: ["chats"],
      limit: 1000,
      sort: "DESC",
      where: [{ statement: "message.ROWID > :cursor", args: { cursor: 0 } }],
    });
  });
  test("walks full initialization pages to the highest ROWID", async () => {
    mocks.request
      .mockResolvedValueOnce(
        Array.from({ length: 1000 }, (_, index) => message(index + 1)),
      )
      .mockResolvedValueOnce([message(1500), message(1200)]);

    const result = await pollBlueBubblesMessages({
      ...CURSOR,
      initialized: false,
      lastRowId: 0,
    });

    expect(result.lastRowId).toBe(1500);
    expect(mocks.request).toHaveBeenLastCalledWith(
      "/api/v1/message/query",
      expect.objectContaining({
        where: [
          { statement: "message.ROWID > :cursor", args: { cursor: 1000 } },
        ],
      }),
    );
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
    await expect(pollBlueBubblesMessages(CURSOR)).rejects.toThrow(
      "cursor was not advanced",
    );
  });
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
        where: [{ statement: "message.ROWID > :cursor", args: { cursor: 0 } }],
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
