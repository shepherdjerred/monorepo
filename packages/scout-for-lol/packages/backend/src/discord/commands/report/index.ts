import { SlashCommandBuilder } from "discord.js";

export const reportCommand = new SlashCommandBuilder()
  .setName("report")
  .setDescription("Manage scheduled reports")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("create")
      .setDescription("Create a scheduled report")
      .addStringOption((option) =>
        option
          .setName("title")
          .setDescription("Report title")
          .setRequired(true)
          .setMaxLength(100),
      )
      .addStringOption((option) =>
        option
          .setName("query")
          .setDescription(
            "SQL-ish query; end with RENDER <kind> to set display",
          )
          .setRequired(true)
          .setMaxLength(4000),
      )
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("Channel where report output is posted")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("schedule-cron")
          .setDescription("Report schedule (CRON, UTC, min 1/day)")
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addStringOption((option) =>
        option
          .setName("description")
          .setDescription("Report description")
          .setRequired(false)
          .setMaxLength(500),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("update")
      .setDescription("Update a user-managed report")
      .addIntegerOption((option) =>
        option
          .setName("report-id")
          .setDescription("ID of the report")
          .setRequired(true)
          .setMinValue(1),
      )
      .addStringOption((option) =>
        option
          .setName("title")
          .setDescription("Report title")
          .setRequired(false)
          .setMaxLength(100),
      )
      .addStringOption((option) =>
        option
          .setName("query")
          .setDescription(
            "SQL-ish query; end with RENDER <kind> to set display",
          )
          .setRequired(false)
          .setMaxLength(4000),
      )
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("Channel where report output is posted")
          .setRequired(false),
      )
      .addStringOption((option) =>
        option
          .setName("schedule-cron")
          .setDescription("Report schedule (CRON, UTC, min 1/day)")
          .setRequired(false)
          .setAutocomplete(true),
      )
      .addBooleanOption((option) =>
        option
          .setName("enabled")
          .setDescription("Whether the report should run on schedule")
          .setRequired(false),
      )
      .addStringOption((option) =>
        option
          .setName("description")
          .setDescription("Report description")
          .setRequired(false)
          .setMaxLength(500),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("run")
      .setDescription("Run a report now and post it to its configured channel")
      .addIntegerOption((option) =>
        option
          .setName("report-id")
          .setDescription("ID of the report")
          .setRequired(true)
          .setMinValue(1),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("run-now")
      .setDescription("Run a report now and post it to its configured channel")
      .addIntegerOption((option) =>
        option
          .setName("report-id")
          .setDescription("ID of the report")
          .setRequired(true)
          .setMinValue(1),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("view")
      .setDescription("View a report definition and latest status")
      .addIntegerOption((option) =>
        option
          .setName("report-id")
          .setDescription("ID of the report")
          .setRequired(true)
          .setMinValue(1),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("disable")
      .setDescription("Disable a user-managed report")
      .addIntegerOption((option) =>
        option
          .setName("report-id")
          .setDescription("ID of the report")
          .setRequired(true)
          .setMinValue(1),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("delete")
      .setDescription("Delete a user-managed report")
      .addIntegerOption((option) =>
        option
          .setName("report-id")
          .setDescription("ID of the report")
          .setRequired(true)
          .setMinValue(1),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("list").setDescription("List reports in this server"),
  );
