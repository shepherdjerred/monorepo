import mineflayer, { type Bot } from "mineflayer";
import { z } from "zod";
import { botVersion } from "./pins.ts";

export type BotOptions = {
  host: string;
  port: number;
  username: string;
  timeoutMs?: number;
};

/** Connects an offline-mode bot and resolves once it has spawned in the world. */
export async function connectBot(options: BotOptions): Promise<Bot> {
  const bot = mineflayer.createBot({
    host: options.host,
    port: options.port,
    username: options.username,
    auth: "offline",
    // Pin the client protocol; auto-detect works only because ViaVersion echoes
    // the client's protocol in the status ping.
    version: botVersion,
    hideErrors: true,
  });
  const timeoutMs = options.timeoutMs ?? 20_000;
  await new Promise<void>((resolve, reject) => {
    const onKicked = (reason: unknown) => {
      finish(
        new Error(`${options.username} kicked: ${JSON.stringify(reason)}`),
      );
    };
    const onError = (error: Error) => {
      finish(error);
    };
    const onEnd = (reason: string) => {
      finish(
        new Error(`${options.username} disconnected before spawn: ${reason}`),
      );
    };
    const onSpawn = () => {
      finish();
    };
    const timer = setTimeout(() => {
      finish(
        new Error(
          `${options.username} did not spawn within ${timeoutMs.toString()}ms`,
        ),
      );
    }, timeoutMs);
    function finish(error?: Error) {
      clearTimeout(timer);
      bot.off("spawn", onSpawn);
      bot.off("kicked", onKicked);
      bot.off("error", onError);
      bot.off("end", onEnd);
      if (error === undefined) {
        resolve();
      } else {
        bot.quit();
        reject(error);
      }
    }
    bot.once("spawn", onSpawn);
    bot.on("kicked", onKicked);
    bot.on("error", onError);
    bot.on("end", onEnd);
  });
  return bot;
}

export async function disconnectBot(bot: Bot): Promise<void> {
  const ended = new Promise<void>((resolve) => {
    bot.once("end", () => {
      resolve();
    });
  });
  bot.quit();
  await Promise.race([ended, Bun.sleep(5000)]);
}

/** Resolves with the first system or chat line that matches, as the bot saw it. */
export async function waitForMessage(
  bot: Bot,
  pattern: RegExp,
  timeoutMs = 10_000,
): Promise<RegExpExecArray> {
  return new Promise((resolve, reject) => {
    const onMessage = (message: string) => {
      const match = pattern.exec(message);
      if (match === null) {
        return;
      }
      clearTimeout(timer);
      bot.off("messagestr", onMessage);
      resolve(match);
    };
    const timer = setTimeout(() => {
      bot.off("messagestr", onMessage);
      reject(new Error(`${bot.username} never saw ${pattern.toString()}`));
    }, timeoutMs);
    bot.on("messagestr", onMessage);
  });
}

/** Polls bot-observed state until the predicate holds. */
export async function waitUntil(
  description: string,
  predicate: () => boolean,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await Bun.sleep(50);
  }
}

type NbtTag = { type: string; value: unknown };
const NbtTagSchema = z.object({ type: z.string(), value: z.unknown() });
const NbtCompoundSchema = z.record(z.string(), NbtTagSchema);
const NbtListSchema = z.object({
  type: z.string(),
  value: z.array(z.unknown()),
});
const NbtLongSchema = z.tuple([z.number(), z.number()]);
const SystemChatSchema = z.object({ content: NbtTagSchema });
const TranslatableSchema = z.object({
  translate: z.string(),
  with: z.array(z.unknown()).default([]),
});

/** Unwraps prismarine's typed NBT tree, keeping longs as bigint. */
function simplifyNbt(tag: NbtTag): unknown {
  switch (tag.type) {
    case "compound": {
      const entries = Object.entries(NbtCompoundSchema.parse(tag.value));
      // Heterogeneous lists wrap each element as a compound with one "" key.
      const only = entries[0];
      return entries.length === 1 && only?.[0] === ""
        ? simplifyNbt(only[1])
        : Object.fromEntries(
            entries.map(([key, value]) => [key, simplifyNbt(value)]),
          );
    }
    case "list": {
      const list = NbtListSchema.parse(tag.value);
      return list.value.map((value) => simplifyNbt({ type: list.type, value }));
    }
    case "long": {
      const [high, low] = NbtLongSchema.parse(tag.value);
      return BigInt.asIntN(64, (BigInt(high) << 32n) | BigInt(low >>> 0));
    }
    default: {
      return tag.value;
    }
  }
}

/**
 * Resolves with the arguments of the next system message using a translation
 * key. prismarine-chat drops NBT long arguments (time, tick counts) when
 * rendering 26.x chat, so assertions on those read the raw packet instead.
 */
export async function waitForTranslation(
  bot: Bot,
  key: string,
  timeoutMs = 10_000,
): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const onPacket = (packet: unknown) => {
      const content = simplifyNbt(SystemChatSchema.parse(packet).content);
      const parsed = TranslatableSchema.safeParse(content);
      if (!parsed.success || parsed.data.translate !== key) {
        return;
      }
      clearTimeout(timer);
      bot._client.off("system_chat", onPacket);
      resolve(parsed.data.with);
    };
    const timer = setTimeout(() => {
      bot._client.off("system_chat", onPacket);
      reject(new Error(`${bot.username} never received ${key}`));
    }, timeoutMs);
    bot._client.on("system_chat", onPacket);
  });
}
