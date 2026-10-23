import { App, Chart } from "cdk8s";
import { describe, expect, it } from "vitest";
import { createGrafanaPostgreSQLDatabase } from "./grafana-db.ts";
import { createScoutPostgreSQLDatabase } from "./scout-db.ts";
import { createSingleAppPostgreSQL } from "./single-app-postgresql.ts";
import { createTemporalPostgreSQLDatabase } from "./temporal-db.ts";
import { createWoodpeckerPostgreSQLDatabase } from "./woodpecker-db.ts";
import { ZFS_WAL_PARAMETERS } from "./zfs-wal-parameters.ts";

function parametersOf(create: (chart: Chart) => unknown): unknown {
  const chart = new Chart(new App(), "postgres", { namespace: "test" });
  create(chart);
  const cluster = chart.toJson().find((object) => object.kind === "postgresql");
  return cluster?.spec?.postgresql?.parameters;
}

describe("ZFS WAL settings on every Zalando cluster", () => {
  it.each([
    [
      "single-app",
      (chart: Chart) =>
        createSingleAppPostgreSQL(chart, { app: "example", userFlags: [] }),
      "4GB",
    ],
    ["temporal", createTemporalPostgreSQLDatabase, "8GB"],
    [
      "scout",
      (chart: Chart) => createScoutPostgreSQLDatabase(chart, "prod"),
      "4GB",
    ],
    ["woodpecker", createWoodpeckerPostgreSQLDatabase, "4GB"],
    ["grafana", createGrafanaPostgreSQLDatabase, "4GB"],
  ] as const)("%s applies the shared set", (_name, create, maxWalSize) => {
    expect(parametersOf(create)).toMatchObject({
      ...ZFS_WAL_PARAMETERS,
      full_page_writes: "off",
      wal_init_zero: "off",
      wal_recycle: "off",
      checkpoint_timeout: "15min",
      max_wal_size: maxWalSize,
    });
  });
});
