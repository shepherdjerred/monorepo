import { z } from "zod";
import { REST, Routes } from "discord.js";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import { fetchPoster } from "@shepherdjerred/streambot/metadata/tmdb.ts";
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

/**
 * Live verification helpers for the e2e that only need `Config` (no playback session) — split out of
 * `run.ts` to keep each file focused. All hit the real Discord/TMDB APIs with the e2e's creds.
 */
const log = logger.child("e2e");

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** A well-known title TMDB will always have a poster for (used by the optional poster check). */
const TMDB_PROBE_TITLE = "Big Buck Bunny";
const TMDB_PROBE_YEAR = 2008;

/**
 * Optional live TMDB check — only runs when `TMDB_API_KEY` is configured. Looks up a well-known title
 * and asserts a poster URL comes back AND is live (HTTP 200), validating the real TMDB + image CDN.
 */
export async function checkTmdbPoster(config: Config): Promise<void> {
  if (config.tmdb === undefined) {
    log.info("e2e: TMDB not configured — skipping poster check");
    return;
  }
  const poster = await fetchPoster(
    config.tmdb.apiKey,
    TMDB_PROBE_TITLE,
    TMDB_PROBE_YEAR,
  );
  if (poster === null) {
    throw new Error(
      `TMDB returned no poster for "${TMDB_PROBE_TITLE}" (${String(TMDB_PROBE_YEAR)})`,
    );
  }
  const head = await fetch(poster.posterUrl, {
    method: "HEAD",
    signal: AbortSignal.timeout(10_000),
  });
  if (!head.ok) {
    throw new Error(
      `TMDB poster URL not live (${String(head.status)}): ${poster.posterUrl}`,
    );
  }
  log.info("e2e: TMDB poster OK", {
    title: poster.tmdbTitle,
    url: poster.posterUrl,
  });
}

/** Minimal projection of a Discord message we read back to verify the posted embed. */
const ChannelMessageSchema = z.object({
  id: z.string(),
  content: z.string().default(""),
  embeds: z
    .array(
      z.object({
        title: z.string().nullish(),
        image: z.object({ url: z.string() }).nullish(),
      }),
    )
    .default([]),
});

/**
 * Verify the full poster path end-to-end: poll the status channel (via the bot REST API) until the
 * now-playing message carrying a TMDB poster embed appears, then delete it to keep the channel tidy.
 * Proves StatusReporter → announce → discord.js embed actually reaches Discord (not just the fetch).
 */
export async function verifyNowPlayingEmbed(config: Config): Promise<void> {
  const rest = new REST().setToken(config.discord.botToken);
  const channelId = config.discord.statusChannelId;
  const deadline = Date.now() + 20_000;
  for (;;) {
    let raw: unknown;
    try {
      raw = await rest.get(Routes.channelMessages(channelId), {
        query: new URLSearchParams({ limit: "20" }),
      });
    } catch (error) {
      if (Date.now() >= deadline) {
        throw new Error(
          `could not read status channel messages: ${getErrorMessage(error)}`,
          { cause: error },
        );
      }
      await sleep(1000);
      continue;
    }
    const messages = z.array(ChannelMessageSchema).parse(raw);
    const hit = messages.find(
      (message) =>
        message.content.includes("Now playing") &&
        message.content.includes("Big Buck Bunny") &&
        message.embeds.some(
          (embed) => embed.image?.url.includes("image.tmdb.org") === true,
        ),
    );
    if (hit !== undefined) {
      const posterEmbed = hit.embeds.find(
        (embed) => embed.image !== null && embed.image !== undefined,
      );
      log.info("e2e: now-playing poster embed verified in Discord", {
        content: hit.content,
        url: posterEmbed?.image?.url,
      });
      try {
        await rest.delete(Routes.channelMessage(channelId, hit.id));
      } catch (error) {
        log.warn("e2e: could not delete test message", {
          error: getErrorMessage(error),
        });
      }
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        "now-playing poster embed not found in status channel within 20s",
      );
    }
    await sleep(1000);
  }
}

/** Projection of a registered application (slash) command — subcommands are nested `options`. */
const AppCommandSchema = z.object({
  name: z.string(),
  options: z
    .array(
      z.object({
        name: z.string(),
        options: z.array(z.object({ name: z.string() })).default([]),
      }),
    )
    .default([]),
});

/**
 * Verify Discord actually accepted the new `/stream chapters` and `/stream chapter <number>`
 * subcommand definitions on the guild — only checkable with real creds, and catches command-schema
 * errors (bad option types, name rules) that nothing else would.
 */
export async function verifyRegisteredCommands(config: Config): Promise<void> {
  const rest = new REST().setToken(config.discord.botToken);
  const app = z
    .object({ id: z.string() })
    .parse(await rest.get(Routes.currentApplication()));
  const commands = z
    .array(AppCommandSchema)
    .parse(
      await rest.get(
        Routes.applicationGuildCommands(app.id, config.discord.guildId),
      ),
    );
  const stream = commands.find((command) => command.name === "stream");
  if (stream === undefined) {
    throw new Error("/stream command not registered on the guild");
  }
  const subcommands = new Set(stream.options.map((option) => option.name));
  for (const required of ["chapters", "chapter"]) {
    if (!subcommands.has(required)) {
      throw new Error(
        `/stream ${required} subcommand not registered on Discord`,
      );
    }
  }
  const chapter = stream.options.find((option) => option.name === "chapter");
  if (chapter?.options.some((option) => option.name === "number") !== true) {
    throw new Error("/stream chapter is missing its 'number' option");
  }
  log.info("e2e: new slash subcommands accepted by Discord", {
    subcommands: [...subcommands],
  });
}
