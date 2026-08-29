import { describe, expect, test, vi } from "vitest";
import {
  type DirectSlashGateway,
  invokeSlashDirect,
} from "#lib/discord/direct-slash.ts";
import { mapMessageMentions } from "#lib/discord/handlers.ts";
import type { IpcMessage } from "#lib/discord/ipc.ts";

function message(overrides: Partial<IpcMessage> = {}): IpcMessage {
  return {
    id: "message-1",
    channelId: "channel-1",
    authorId: "bot-1",
    authorTag: "Derrej#8685",
    authorIsBot: true,
    content: "public receipt",
    createdAt: "2026-08-29T00:00:00.000Z",
    embeds: [],
    attachments: [],
    mentionUserIds: ["recipient", "sender"],
    mentionRoleIds: [],
    mentionsEveryone: false,
    ...overrides,
  };
}

class FakeGateway implements DirectSlashGateway {
  closed = false;
  invoked = false;
  onInvoke: ((onMessage: (message: IpcMessage) => void) => void) | null = null;
  #onMessage: ((message: IpcMessage) => void) | null = null;

  async connect(
    _token: string,
    onMessage: (message: IpcMessage) => void,
  ): Promise<string> {
    this.#onMessage = onMessage;
    return "user-1";
  }

  async invoke(): Promise<IpcMessage> {
    this.invoked = true;
    if (this.#onMessage === null) {
      throw new Error("Fake gateway was invoked before connection");
    }
    this.onInvoke?.(this.#onMessage);
    return message({ id: "private-reply", content: "private acknowledgement" });
  }

  close(): void {
    this.closed = true;
  }
}

const parameters = {
  token: "user-token",
  channelId: "channel-1",
  botId: "bot-1",
  command: "bb",
  args: ["transfer", "recipient", "3"],
  waitForPublicResponse: true,
  publicResponseContains: "receipt",
  timeoutSeconds: 30,
};

describe("invokeSlashDirect", () => {
  test("returns the private reply and matching public response", async () => {
    const gateway = new FakeGateway();
    gateway.onInvoke = (onMessage) => {
      onMessage(message({ id: "ignored", content: "something else" }));
      onMessage(message({ id: "public-receipt" }));
    };

    const result = await invokeSlashDirect(parameters, gateway);

    expect(result).toEqual({
      invoked: true,
      invokingUserId: "user-1",
      reply: message({
        id: "private-reply",
        content: "private acknowledgement",
      }),
      publicResponse: message({ id: "public-receipt" }),
      publicResponseTimedOut: false,
    });
    expect(gateway.invoked).toBe(true);
    expect(gateway.closed).toBe(true);
  });

  test("returns a structured timeout and closes the gateway", async () => {
    vi.useFakeTimers();
    try {
      const gateway = new FakeGateway();
      const resultPromise = invokeSlashDirect(
        { ...parameters, timeoutSeconds: 1 },
        gateway,
      );
      await vi.advanceTimersByTimeAsync(1000);

      await expect(resultPromise).resolves.toMatchObject({
        publicResponse: null,
        publicResponseTimedOut: true,
      });
      expect(gateway.closed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test("rejects a missing credential before invocation and still closes", async () => {
    const gateway = new FakeGateway();

    await expect(
      invokeSlashDirect({ ...parameters, token: "" }, gateway),
    ).rejects.toThrow("requires a user token");
    expect(gateway.invoked).toBe(false);
    expect(gateway.closed).toBe(true);
  });

  test("closes the gateway when invocation fails", async () => {
    const gateway = new FakeGateway();
    gateway.invoke = () => Promise.reject(new Error("Discord rejected it"));

    await expect(invokeSlashDirect(parameters, gateway)).rejects.toThrow(
      "Discord rejected it",
    );
    expect(gateway.closed).toBe(true);
  });

  test("a hanging invocation hits the watchdog and closes the gateway", async () => {
    vi.useFakeTimers();
    try {
      const gateway = new FakeGateway();
      gateway.invoke = () =>
        new Promise(() => {
          // Deliberately pending so the invocation watchdog owns teardown.
        });
      const resultPromise = invokeSlashDirect(
        { ...parameters, timeoutSeconds: 1 },
        gateway,
      );
      const expectation = expect(resultPromise).rejects.toThrow(
        "slash invocation did not finish",
      );
      await vi.advanceTimersByTimeAsync(1000);

      await expectation;
      expect(gateway.closed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

test("mention extraction preserves exact users, roles, and everyone", () => {
  expect(
    mapMessageMentions(["user-2", "user-1"], ["role-2", "role-1"], true),
  ).toEqual({
    mentionUserIds: ["user-1", "user-2"],
    mentionRoleIds: ["role-1", "role-2"],
    mentionsEveryone: true,
  });
});
