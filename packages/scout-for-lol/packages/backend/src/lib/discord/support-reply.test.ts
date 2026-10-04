import { afterEach, expect, test, vi } from "vitest";
import { REST } from "discord.js";
import { deliverSupportReply } from "#src/lib/discord/support-reply.ts";
import { testAccountId, testChannelId } from "#src/testing/test-ids.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

test("REST replies open a DM and suppress every mention without a gateway", async () => {
  const channelId = testChannelId("991011");
  const userId = testAccountId("991012");
  const post = vi
    .spyOn(REST.prototype, "post")
    .mockResolvedValueOnce({ id: channelId })
    .mockResolvedValueOnce({});
  await deliverSupportReply(userId, "Thanks @everyone <@123>!");
  expect(post).toHaveBeenNthCalledWith(1, "/users/@me/channels", {
    body: { recipient_id: userId },
  });
  expect(post).toHaveBeenNthCalledWith(2, `/channels/${channelId}/messages`, {
    body: {
      content: "Thanks @everyone <@123>!",
      allowed_mentions: { parse: [] },
    },
  });
});

test("a failed channel lookup never attempts the message send", async () => {
  const failure = new Error("Discord unavailable");
  const post = vi.spyOn(REST.prototype, "post").mockRejectedValueOnce(failure);
  await expect(
    deliverSupportReply(testAccountId("991012"), "hello"),
  ).rejects.toBe(failure);
  expect(post).toHaveBeenCalledOnce();
});
