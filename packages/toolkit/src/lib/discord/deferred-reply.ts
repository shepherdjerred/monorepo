import {
  Message as UserMessage,
  type Client as UserClient,
  type PartialMessage as UserPartialMessage,
} from "discord.js-selfbot-v13";
import type { IpcMessage } from "#lib/discord/ipc.ts";

export function isDeferredReply(message: IpcMessage): boolean {
  return message.content.length === 0 && message.embeds.length === 0;
}

export function createUserMessageUpdateWatcher(
  user: UserClient,
  mapMessage: (message: UserMessage) => IpcMessage,
): {
  waitFor: (
    reply: IpcMessage,
    timeoutMilliseconds: number,
  ) => Promise<IpcMessage>;
  close: () => void;
} {
  const updatedMessages = new Map<string, IpcMessage>();
  let activeWait: {
    replyId: string;
    finish: (message: IpcMessage) => void;
  } | null = null;
  const listener = async (
    _oldMessage: UserMessage | UserPartialMessage,
    newMessage: UserMessage | UserPartialMessage,
  ): Promise<void> => {
    try {
      const fetched =
        newMessage instanceof UserMessage
          ? newMessage
          : await newMessage.fetch();
      const mapped = mapMessage(fetched);
      updatedMessages.set(mapped.id, mapped);
      if (activeWait?.replyId === mapped.id) {
        activeWait.finish(mapped);
      }
    } catch {
      // The message may have been removed before a partial update was fetched.
    }
  };
  user.on("messageUpdate", listener);
  return {
    waitFor: (reply, timeoutMilliseconds) => {
      const existing = updatedMessages.get(reply.id);
      if (existing !== undefined) {
        return Promise.resolve(existing);
      }
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          activeWait = null;
          resolve(reply);
        }, timeoutMilliseconds);
        activeWait = {
          replyId: reply.id,
          finish: (message) => {
            clearTimeout(timer);
            activeWait = null;
            resolve(message);
          },
        };
      });
    },
    close: () => {
      user.off("messageUpdate", listener);
    },
  };
}
