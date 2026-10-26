import mineflayer, { type Bot } from "mineflayer";
import { z } from "zod";
import type { RconClient } from "#e2e/harness/rcon.ts";
import { botVersion } from "./pins.ts";

export type BotOptions = {
  host: string;
  port: number;
  username: string;
  timeoutMs?: number;
  onMessage?: (message: string) => void;
  /** Runs after the client exists and before the spawn wait, so early packets are visible. */
  prepare?: (bot: Bot) => void;
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
  // Arrival messages may precede the spawn packet that resolves connectBot.
  if (options.onMessage !== undefined) bot.on("messagestr", options.onMessage);
  options.prepare?.(bot);
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

/** Collects all rendered chat lines observed during a fixed window. */
export async function collectMessages(
  bot: Bot,
  durationMs: number,
): Promise<string[]> {
  const messages: string[] = [];
  const onMessage = (message: string) => {
    messages.push(message);
  };
  bot.on("messagestr", onMessage);
  await Bun.sleep(durationMs);
  bot.off("messagestr", onMessage);
  return messages;
}

/** Polls bot-observed state until the predicate holds. */
export async function waitUntil(
  description: string,
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await Bun.sleep(50);
  }
}

/** The yaw and pitch, in protocol degrees, that the server holds for `bot`. */
async function serverFacing(
  rcon: RconClient,
  bot: Bot,
): Promise<{ yaw: number; pitch: number }> {
  const reply = await rcon.command(`data get entity ${bot.username} Rotation`);
  const groups = /\[(?<yaw>-?[\d.]+)f, (?<pitch>-?[\d.]+)f\]$/u.exec(
    reply.trim(),
  )?.groups;
  const yaw = groups?.["yaw"];
  const pitch = groups?.["pitch"];
  if (yaw === undefined || pitch === undefined) {
    throw new Error(`No rotation in ${reply}`);
  }
  return { yaw: Number(yaw), pitch: Number(pitch) };
}

/** How far apart two angles in degrees are, the short way round. */
function degreesApart(a: number, b: number): number {
  return Math.abs(((((a - b) % 360) + 540) % 360) - 180);
}

/** Polls the server until it holds `bot`'s current Mineflayer facing. */
async function facingReaches(
  rcon: RconClient,
  bot: Bot,
  timeoutMs: number,
): Promise<boolean> {
  // Mineflayer rounds a turn to mouse steps; compare the facing it sent.
  const yaw = 180 - (bot.entity.yaw * 180) / Math.PI;
  const pitch = (-bot.entity.pitch * 180) / Math.PI;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const seen = await serverFacing(rcon, bot);
    if (
      degreesApart(seen.yaw, yaw) < 0.5 &&
      Math.abs(seen.pitch - pitch) < 0.5
    ) {
      return true;
    }
    await Bun.sleep(100);
  }
  return false;
}

/**
 * Turns `bot` to Mineflayer `yaw` and `pitch` and waits until the server holds
 * that facing. Grim discards movement, turns included, from a player standing
 * in a chunk it has not confirmed the client holds, which can last for a whole
 * match after a teleport. It never discards the position a client reports on
 * accepting a teleport, so an in-place teleport makes the client report the
 * facing it already turned to.
 */
export async function faceSeen(
  rcon: RconClient,
  bot: Bot,
  yaw: number,
  pitch: number,
): Promise<void> {
  await bot.look(yaw, pitch, true);
  if (await facingReaches(rcon, bot, 1000)) return;
  await rcon.command(
    `execute as ${bot.username} at @s run minecraft:tp @s ~ ~ ~`,
  );
  if (await facingReaches(rcon, bot, 10_000)) return;
  throw new Error(`The server never received ${bot.username}'s facing`);
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
