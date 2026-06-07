import { SlashCommandBuilder } from "discord.js";

/**
 * Slash command definitions. Registered guild-scoped on `ready` (instant). Handlers live in
 * `command-bot.ts`. Commands work in any channel; world-readable output goes to the status channel.
 */
export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription(
      "Queue and play a video (library title, URL, playlist, or search)",
    )
    .addStringOption((o) =>
      o
        .setName("query")
        .setDescription("library title, URL, or search terms")
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("playnext")
    .setDescription("Queue a video to play next (front of the queue)")
    .addStringOption((o) =>
      o
        .setName("query")
        .setDescription("library title, URL, or search terms")
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Skip the current video"),
  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Stop playback and clear the queue (admin)"),
  new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Show the current queue"),
  new SlashCommandBuilder()
    .setName("nowplaying")
    .setDescription("Show what's currently playing"),
  new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Remove an item from the queue")
    .addIntegerOption((o) =>
      o
        .setName("index")
        .setDescription("queue position (1-based)")
        .setMinValue(1)
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Clear the queue (admin)"),
  new SlashCommandBuilder()
    .setName("move")
    .setDescription("Move a queued item to a new position")
    .addIntegerOption((o) =>
      o
        .setName("from")
        .setDescription("current position (1-based)")
        .setMinValue(1)
        .setRequired(true),
    )
    .addIntegerOption((o) =>
      o
        .setName("to")
        .setDescription("new position (1-based)")
        .setMinValue(1)
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("shuffle")
    .setDescription("Shuffle the queue"),
  new SlashCommandBuilder()
    .setName("loop")
    .setDescription("Set the loop mode")
    .addStringOption((o) =>
      o
        .setName("mode")
        .setDescription("off, track, or queue")
        .setRequired(true)
        .addChoices(
          { name: "off", value: "off" },
          { name: "track", value: "track" },
          { name: "queue", value: "queue" },
        ),
    ),
  new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Set playback volume (0-200%)")
    .addIntegerOption((o) =>
      o
        .setName("level")
        .setDescription("0-200")
        .setMinValue(0)
        .setMaxValue(200)
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("list")
    .setDescription("Browse the video library")
    .addStringOption((o) =>
      o.setName("filter").setDescription("optional search filter"),
    ),
  new SlashCommandBuilder()
    .setName("search")
    .setDescription("Search the video library")
    .addStringOption((o) =>
      o.setName("query").setDescription("search terms").setRequired(true),
    ),
];

export const commandJson = commandDefinitions.map((command) =>
  command.toJSON(),
);
