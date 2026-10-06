import {
  Client as UserClient,
  Message as UserMessage,
  type PartialMessage as UserPartialMessage,
} from "discord.js-selfbot-v13";
import { isDeferredReply } from "#lib/discord/deferred-reply.ts";
import { mapUserMessage, messageMatches } from "#lib/discord/handlers.ts";
import type { DirectSlashResponse, IpcMessage } from "#lib/discord/ipc.ts";

export type DirectSlashGateway = {
  connect: (
    token: string,
    onMessage: (message: IpcMessage) => void,
  ) => Promise<string>;
  invoke: (params: {
    channelId: string;
    botId: string;
    command: string;
    args: string[];
    onMessageUpdate: (message: IpcMessage) => void;
  }) => Promise<IpcMessage | null>;
  close: () => void;
};

export type DirectSlashParameters = {
  token: string;
  channelId: string;
  botId: string;
  command: string;
  args: string[];
  waitForPublicResponse: boolean;
  publicResponseContains?: string | undefined;
  timeoutSeconds: number;
};

async function rejectAfter<T>(
  promise: Promise<T>,
  milliseconds: number,
  message: string,
): Promise<T> {
  const timeout = Promise.withResolvers<T>();
  const timer = setTimeout(() => {
    timeout.reject(new Error(message));
  }, milliseconds);
  try {
    return await Promise.race([promise, timeout.promise]);
  } finally {
    clearTimeout(timer);
  }
}

async function nullAfter<T>(
  promise: Promise<T>,
  milliseconds: number,
): Promise<T | null> {
  const timeout = Promise.withResolvers<null>();
  const timer = setTimeout(() => {
    timeout.resolve(null);
  }, milliseconds);
  try {
    return await Promise.race([promise, timeout.promise]);
  } finally {
    clearTimeout(timer);
  }
}

function remainingMilliseconds(deadline: number): number {
  return Math.max(1, deadline - Date.now());
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function handleMessageUpdate(
  newMessage: UserMessage | UserPartialMessage,
  onMessageUpdate: (message: IpcMessage) => void,
): Promise<void> {
  try {
    const message =
      newMessage instanceof UserMessage ? newMessage : await newMessage.fetch();
    onMessageUpdate(mapUserMessage(message));
  } catch {
    // The message may have been removed before a partial update was fetched.
  }
}

export class SelfbotDirectSlashGateway implements DirectSlashGateway {
  readonly #client = new UserClient();
  #messageListener: ((message: UserMessage) => void) | null = null;
  #messageUpdateListener:
    | ((
        oldMessage: UserMessage | UserPartialMessage,
        newMessage: UserMessage | UserPartialMessage,
      ) => void)
    | null = null;

  async connect(
    token: string,
    onMessage: (message: IpcMessage) => void,
  ): Promise<string> {
    this.#messageListener = (message: UserMessage): void => {
      onMessage(mapUserMessage(message));
    };
    this.#client.on("messageCreate", this.#messageListener);

    const ready = new Promise<void>((resolve, reject) => {
      const onReady = (): void => {
        this.#client.off("error", onError);
        resolve();
      };
      const onError = (error: Error): void => {
        this.#client.off("ready", onReady);
        reject(error);
      };
      this.#client.once("ready", onReady);
      this.#client.once("error", onError);
    });
    await this.#client.login(token);
    await ready;
    const user = this.#client.user;
    if (user === null) {
      throw new Error("Discord user gateway became ready without a user");
    }
    return user.id;
  }

  async invoke(params: {
    channelId: string;
    botId: string;
    command: string;
    args: string[];
    onMessageUpdate: (message: IpcMessage) => void;
  }): Promise<IpcMessage | null> {
    const channel = await this.#client.channels.fetch(params.channelId);
    if (channel?.isText() !== true) {
      throw new Error(`Channel ${params.channelId} is not a user text channel`);
    }
    this.#messageUpdateListener = (_oldMessage, newMessage): void => {
      void handleMessageUpdate(newMessage, params.onMessageUpdate);
    };
    this.#client.on("messageUpdate", this.#messageUpdateListener);
    const result = await channel.sendSlash(
      params.botId,
      params.command,
      ...params.args,
    );
    return result instanceof UserMessage ? mapUserMessage(result) : null;
  }

  close(): void {
    if (this.#messageListener !== null) {
      this.#client.off("messageCreate", this.#messageListener);
      this.#messageListener = null;
    }
    if (this.#messageUpdateListener !== null) {
      this.#client.off("messageUpdate", this.#messageUpdateListener);
      this.#messageUpdateListener = null;
    }
    try {
      this.#client.destroy();
    } catch (error) {
      console.error(
        `Discord user gateway teardown failed: ${errorMessage(error)}`,
      );
    }
  }
}

export async function invokeSlashDirect(
  params: DirectSlashParameters,
  gateway: DirectSlashGateway = new SelfbotDirectSlashGateway(),
): Promise<DirectSlashResponse> {
  const deadline = Date.now() + params.timeoutSeconds * 1000;
  let resolvePublicResponse: ((message: IpcMessage) => void) | null = null;
  let resolveReplyUpdate: ((message: IpcMessage) => void) | undefined;
  let replyUpdate: IpcMessage | null = null;
  const updatedMessages = new Map<string, IpcMessage>();
  const replyUpdatePromise = new Promise<IpcMessage>((resolve) => {
    resolveReplyUpdate = resolve;
  });
  const publicResponsePromise = new Promise<IpcMessage>((resolve) => {
    resolvePublicResponse = resolve;
  });
  const onMessage = (message: IpcMessage): void => {
    if (
      params.waitForPublicResponse &&
      messageMatches(message, {
        channelId: params.channelId,
        fromUserId: params.botId,
        contains: params.publicResponseContains,
      })
    ) {
      resolvePublicResponse?.(message);
    }
  };
  const onMessageUpdate = (message: IpcMessage): void => {
    updatedMessages.set(message.id, message);
    if (replyUpdate === null) {
      return;
    }
    if (message.id === replyUpdate.id) {
      resolveReplyUpdate?.(message);
    }
  };

  try {
    if (params.token.length === 0) {
      throw new Error("Direct Discord slash invocation requires a user token");
    }
    const invokingUserId = await rejectAfter(
      gateway.connect(params.token, onMessage),
      remainingMilliseconds(deadline),
      `Discord user gateway did not become ready within ${String(params.timeoutSeconds)} seconds`,
    );
    const reply = await rejectAfter(
      gateway.invoke({ ...params, onMessageUpdate }),
      remainingMilliseconds(deadline),
      `Discord slash invocation did not finish within ${String(params.timeoutSeconds)} seconds`,
    );
    const finalReply =
      reply !== null && isDeferredReply(reply)
        ? await ((): Promise<IpcMessage | null> => {
            replyUpdate = reply;
            const alreadyUpdated = updatedMessages.get(reply.id);
            if (
              alreadyUpdated !== undefined &&
              resolveReplyUpdate !== undefined
            ) {
              resolveReplyUpdate(alreadyUpdated);
            }
            return nullAfter(
              replyUpdatePromise,
              remainingMilliseconds(deadline),
            );
          })()
        : null;
    const publicResponse = params.waitForPublicResponse
      ? await nullAfter(publicResponsePromise, remainingMilliseconds(deadline))
      : null;
    return {
      invoked: true,
      invokingUserId,
      reply: finalReply ?? reply,
      publicResponse,
      publicResponseTimedOut:
        params.waitForPublicResponse && publicResponse === null,
    };
  } finally {
    gateway.close();
  }
}
