import { expect, it, vi } from "vitest";
import { editOwnDiscordMessage } from "#lib/discord/edit-own-message.ts";

const request = {
  guildId: "1",
  channelId: "2",
  messageId: "3",
  expectedAuthorId: "4",
  content: "We're rebuilding.\n\nJoin us.",
};
const message = {
  id: "3",
  guildId: "1",
  channelId: "2",
  authorId: "4",
  content: "broken",
};
it("edits once and independently verifies the exact copy", async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce(message)
    .mockResolvedValueOnce({
      ...message,
      content: request.content,
    });
  const edit = vi.fn().mockResolvedValue(undefined);
  await expect(
    editOwnDiscordMessage({ request, selfId: "4", read, edit }),
  ).resolves.toEqual({ edited: true, alreadyMatched: false, messageId: "3" });
  expect(edit).toHaveBeenCalledExactlyOnceWith(request.content);
  expect(read).toHaveBeenCalledTimes(2);
});
it.each([{ id: "5" }, { guildId: "5" }, { channelId: "5" }, { authorId: "5" }])(
  "rejects an unrelated message before writing: %j",
  async (mismatch) => {
    const edit = vi.fn();
    await expect(
      editOwnDiscordMessage({
        request,
        selfId: "4",
        read: async () => ({ ...message, ...mismatch }),
        edit,
      }),
    ).rejects.toThrow("identity mismatch");
    expect(edit).not.toHaveBeenCalled();
  },
);
it("rejects an identity other than the signed-in user", async () => {
  const edit = vi.fn();
  await expect(
    editOwnDiscordMessage({
      request,
      selfId: "5",
      read: async () => message,
      edit,
    }),
  ).rejects.toThrow("identity mismatch");
  expect(edit).not.toHaveBeenCalled();
});
it("does not repeat an edit after a failed readback", async () => {
  const edit = vi.fn().mockResolvedValue(undefined);
  await expect(
    editOwnDiscordMessage({
      request,
      selfId: "4",
      read: async () => message,
      edit,
    }),
  ).rejects.toThrow("do not repeat");
  expect(edit).toHaveBeenCalledTimes(1);
});
it("avoids a write when the exact copy is already present", async () => {
  const edit = vi.fn();
  await expect(
    editOwnDiscordMessage({
      request,
      selfId: "4",
      read: async () => ({ ...message, content: request.content }),
      edit,
    }),
  ).resolves.toMatchObject({ alreadyMatched: true });
  expect(edit).not.toHaveBeenCalled();
});
