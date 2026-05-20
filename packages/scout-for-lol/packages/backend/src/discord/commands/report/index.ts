import { SlashCommandBuilder } from "discord.js";
import {
  REPORT_MAX_LOOKBACK_DAYS,
  REPORT_MAX_ROWS_LIMIT,
} from "@scout-for-lol/data";

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
          .setDescription("SQL-ish report query")
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
          .setName("output-format")
          .setDescription("How the report should render")
          .setRequired(false)
          .addChoices(
            { name: "Leaderboard", value: "LEADERBOARD" },
            { name: "List", value: "LIST" },
            { name: "Table", value: "TABLE" },
            { name: "Bar Chart", value: "BAR_CHART" },
            { name: "Line Chart", value: "LINE_CHART" },
          ),
      )
      .addIntegerOption((option) =>
        option
          .setName("lookback-days")
          .setDescription("Days of SQLite facts to scan")
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(REPORT_MAX_LOOKBACK_DAYS),
      )
      .addIntegerOption((option) =>
        option
          .setName("max-rows")
          .setDescription("Maximum rows to post")
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(REPORT_MAX_ROWS_LIMIT),
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
          .setDescription("SQL-ish report query")
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
      .addStringOption((option) =>
        option
          .setName("output-format")
          .setDescription("How the report should render")
          .setRequired(false)
          .addChoices(
            { name: "Leaderboard", value: "LEADERBOARD" },
            { name: "List", value: "LIST" },
            { name: "Table", value: "TABLE" },
            { name: "Bar Chart", value: "BAR_CHART" },
            { name: "Line Chart", value: "LINE_CHART" },
          ),
      )
      .addIntegerOption((option) =>
        option
          .setName("lookback-days")
          .setDescription("Days of SQLite facts to scan")
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(REPORT_MAX_LOOKBACK_DAYS),
      )
      .addIntegerOption((option) =>
        option
          .setName("max-rows")
          .setDescription("Maximum rows to post")
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(REPORT_MAX_ROWS_LIMIT),
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
