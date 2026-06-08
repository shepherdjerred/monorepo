import { SlashCommandBuilder } from "discord.js";

/**
 * Slash command definitions. A single top-level `/stream` command with subcommands
 * (`/stream play`, `/stream skip`, …). Registered guild-scoped on `ready` (instant). Handlers
 * live in `command-bot.ts`, keyed on the subcommand name. Commands work in any channel;
 * world-readable output goes to the status channel.
 */
export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName("stream")
    .setDescription("Control the video stream")
    .addSubcommand((sub) =>
      sub
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
    )
    .addSubcommand((sub) =>
      sub
        .setName("playnext")
        .setDescription("Queue a video to play next (front of the queue)")
        .addStringOption((o) =>
          o
            .setName("query")
            .setDescription("library title, URL, or search terms")
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName("skip").setDescription("Skip the current video"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("stop")
        .setDescription("Stop playback and clear the queue (admin)"),
    )
    .addSubcommand((sub) =>
      sub.setName("queue").setDescription("Show the current queue"),
    )
    .addSubcommand((sub) =>
      sub.setName("nowplaying").setDescription("Show what's currently playing"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Remove an item from the queue")
        .addIntegerOption((o) =>
          o
            .setName("index")
            .setDescription("queue position (1-based)")
            .setMinValue(1)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName("clear").setDescription("Clear the queue (admin)"),
    )
    .addSubcommand((sub) =>
      sub
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
    )
    .addSubcommand((sub) =>
      sub.setName("shuffle").setDescription("Shuffle the queue"),
    )
    .addSubcommand((sub) =>
      sub
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
    )
    .addSubcommand((sub) =>
      sub
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
    )
    .addSubcommand((sub) =>
      sub
        .setName("seek")
        .setDescription("Jump to a position in the current video")
        .addStringOption((o) =>
          o
            .setName("position")
            .setDescription("timestamp: 90, 1:30, or 1:02:03")
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("chapters")
        .setDescription("List the chapters of the current video"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("chapter")
        .setDescription("Jump to a chapter of the current video")
        .addIntegerOption((o) =>
          o
            .setName("number")
            .setDescription("chapter number (1-based)")
            .setMinValue(1)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("list")
        .setDescription("Browse the video library")
        .addStringOption((o) =>
          o.setName("filter").setDescription("optional search filter"),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("search")
        .setDescription("Search the video library")
        .addStringOption((o) =>
          o.setName("query").setDescription("search terms").setRequired(true),
        ),
    ),
];

export const commandJson = commandDefinitions.map((command) =>
  command.toJSON(),
);
