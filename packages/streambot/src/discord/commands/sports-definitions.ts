import type { SlashCommandSubcommandGroupBuilder } from "discord.js";
export function addSportsCommands(group: SlashCommandSubcommandGroupBuilder) {
  return group
    .addSubcommand((sub) =>
      sub
        .setName("sports")
        .setDescription("Browse live sports and competitive LoL schedules")
        .addStringOption((o) =>
          o
            .setName("provider")
            .setDescription("Sports source")
            .addChoices(
              { name: "All", value: "auto" },
              { name: "LoL Esports", value: "lolesports" },
              { name: "StreamEast", value: "streameast" },
              { name: "TVSportsLive", value: "tvsportslive" },
            ),
        )
        .addStringOption((o) =>
          o
            .setName("league")
            .setDescription("LoL competition (choose LoL Esports provider)")
            .addChoices(
              ...[
                "lck",
                "worlds",
                "msi",
                "first_stand",
                "lpl",
                "lec",
                "lcs",
              ].map((value) => ({
                name: value.toUpperCase().replaceAll("_", " "),
                value,
              })),
            ),
        )
        .addStringOption((o) =>
          o
            .setName("range")
            .setDescription("LoL schedule window")
            .addChoices(
              { name: "Today", value: "today" },
              { name: "Next seven days", value: "week" },
            ),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("sports-schedules")
        .setDescription("List your scheduled LoL series and cancellation IDs"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("sports-cancel")
        .setDescription("Cancel a scheduled LoL series")
        .addStringOption((o) =>
          o
            .setName("id")
            .setDescription("Schedule ID from sports-schedules")
            .setRequired(true),
        ),
    );
}
