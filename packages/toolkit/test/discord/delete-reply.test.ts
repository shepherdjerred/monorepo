import { describe, expect, it, vi } from "vitest";
import { deleteDiscordReply } from "#lib/discord/delete-reply.ts";

const request = {
  guildId: "1",
  channelId: "2",
  messageId: "3",
  expectedAuthorId: "4",
};
const message = {
  id: "3",
  guildId: "1",
  channelId: "2",
  authorId: "4",
  authorIsBot: true,
};
const missing = () =>
  Promise.reject(Object.assign(new Error("Unknown message"), { code: 10_008 }));

describe("exact bot reply cleanup", () => {
  it("deletes once and confirms absence", async () => {
    const read = vi
      .fn<() => Promise<typeof message>>()
      .mockResolvedValueOnce(message)
      .mockImplementationOnce(missing);
    const remove = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    await expect(
      deleteDiscordReply({ request, read, remove }),
    ).resolves.toEqual({ deleted: true, alreadyAbsent: false });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("accepts an already deleted reply without another write", async () => {
    const remove = vi.fn<() => Promise<void>>();
    await expect(
      deleteDiscordReply({ request, read: missing, remove }),
    ).resolves.toEqual({ deleted: true, alreadyAbsent: true });
    expect(remove).not.toHaveBeenCalled();
  });
  it("accepts the user SDK's exact-message absence response", async () => {
    const remove = vi.fn<() => Promise<void>>();
    await expect(
      deleteDiscordReply({
        request,
        read: () => Promise.reject(new Error("MESSAGE_ID_NOT_FOUND")),
        remove,
      }),
    ).resolves.toEqual({ deleted: true, alreadyAbsent: true });
    expect(remove).not.toHaveBeenCalled();
  });
  it.each([
    { authorId: "5" },
    { channelId: "5" },
    { guildId: "5" },
    { id: "5" },
    { authorIsBot: false },
  ])("rejects a mismatched reply: %j", async (mismatch) => {
    const remove = vi.fn<() => Promise<void>>();
    await expect(
      deleteDiscordReply({
        request,
        read: () => Promise.resolve({ ...message, ...mismatch }),
        remove,
      }),
    ).rejects.toThrow("identity");
    expect(remove).not.toHaveBeenCalled();
  });
  it("surfaces missing permissions without repeating the delete", async () => {
    const remove = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(new Error("Missing Permissions"));
    await expect(
      deleteDiscordReply({
        request,
        read: () => Promise.resolve(message),
        remove,
      }),
    ).rejects.toThrow("Missing Permissions");
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
