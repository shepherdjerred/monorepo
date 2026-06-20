import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import * as common from "@grafana/grafana-foundation-sdk/common";
import * as stat from "@grafana/grafana-foundation-sdk/stat";
import * as table from "@grafana/grafana-foundation-sdk/table";
import * as prometheus from "@grafana/grafana-foundation-sdk/prometheus";

type PrometheusDatasource = { type: string; uid: string };

const FILTER = 'environment=~"$environment",instance=~"$server"';
const buildFilter = () => FILTER;

/**
 * "Guild health" row: surfaces servers that have the bot but where nothing is
 * being delivered, and competitions whose leaderboard reports are failing.
 */
export function addGuildHealthRows(
  builder: dashboard.DashboardBuilder,
  prometheusDatasource: PrometheusDatasource,
): void {
  builder.withRow(
    new dashboard.RowBuilder("Guild health").gridPos({
      x: 0,
      y: 130,
      w: 24,
      h: 1,
    }),
  );

  // Headline counts.
  builder.withPanel(
    new stat.PanelBuilder()
      .title("Guilds — delivery blocked")
      .description(
        "Servers where the bot is a member but message delivery is currently failing (missing perms, deleted channel, etc.).",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum by (environment) (guild_send_blocked_total{${buildFilter()}}) or on() vector(0)`,
          )
          .legendFormat("{{environment}}"),
      )
      .unit("short")
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.Area)
      .gridPos({ x: 0, y: 131, w: 6, h: 4 }),
  );

  builder.withPanel(
    new stat.PanelBuilder()
      .title("Competitions — unhealthy")
      .description(
        "Active competitions whose leaderboard report last failed to generate.",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum by (environment) (competition_unhealthy_total{${buildFilter()}}) or on() vector(0)`,
          )
          .legendFormat("{{environment}}"),
      )
      .unit("short")
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.Area)
      .gridPos({ x: 6, y: 131, w: 6, h: 4 }),
  );

  // Drill-down tables (joined to server names via guild_info).
  builder.withPanel(
    new table.PanelBuilder()
      .title("Delivery-blocked guilds")
      .description(
        "Which servers the bot can't currently deliver to. Join of guild_send_blocked with guild_info for the server name.",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `guild_send_blocked{${buildFilter()}} * on(server_id) group_left(server_name) guild_info{${buildFilter()}}`,
          )
          .legendFormat("{{server_name}}")
          .format(prometheus.PromQueryFormat.Table)
          .instant(),
      )
      .gridPos({ x: 0, y: 135, w: 12, h: 8 }),
  );

  builder.withPanel(
    new table.PanelBuilder()
      .title("Unhealthy competitions")
      .description(
        "Active competitions whose leaderboard report is failing, with the owning server name.",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `competition_unhealthy{${buildFilter()}} * on(server_id) group_left(server_name) guild_info{${buildFilter()}}`,
          )
          .legendFormat("{{server_name}} / {{competition_id}}")
          .format(prometheus.PromQueryFormat.Table)
          .instant(),
      )
      .gridPos({ x: 12, y: 135, w: 12, h: 8 }),
  );
}
