import { beforeEach, describe, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), config: vi.fn() }));
vi.mock("#lib/bluebubbles/client.ts", () => ({
  blueBubblesRequest: mocks.request,
}));
vi.mock("#config/imessage.ts", () => ({ imessageIngressConfig: mocks.config }));
import { pollBlueBubblesMessages } from "./poll.ts";

const CURSOR = { startedAt: "2026-09-17T00:00:00.000Z", lastRowId: 10 };
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
        after: Date.parse(CURSOR.startedAt),
        where: [{ statement: "message.ROWID > :cursor", args: { cursor: 10 } }],
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
  ])("does not contact the server when disabled or unowned", async (config) => {
    mocks.config.mockResolvedValue(config);
    const result = await pollBlueBubblesMessages(CURSOR);
    expect(result).toMatchObject({
      lastRowId: 10,
      commands: [],
    });
    expect(Date.parse(result.startedAt)).toBeGreaterThan(
      Date.parse(CURSOR.startedAt),
    );
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
