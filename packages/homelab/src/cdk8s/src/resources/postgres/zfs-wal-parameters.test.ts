import { App, Chart } from "cdk8s";
import { describe, expect, it } from "vitest";
import {
  NVME_STORAGE_CLASS,
  NVME_STORAGE_CLASS_LZ4,
} from "@shepherdjerred/homelab/cdk8s/src/misc/storage/storage-classes.ts";
import { createGrafanaPostgreSQLDatabase } from "./grafana-db.ts";
import { createScoutPostgreSQLDatabase } from "./scout-db.ts";
import {
  createSingleAppPostgreSQL,
  GRANDFATHERED_ZFS_SSD_POSTGRES_APPS,
} from "./single-app-postgresql.ts";
import { createTemporalPostgreSQLDatabase } from "./temporal-db.ts";
import { createWoodpeckerPostgreSQLDatabase } from "./woodpecker-db.ts";
import { ZFS_WAL_PARAMETERS } from "./zfs-wal-parameters.ts";

function clusterOf(create: (chart: Chart) => unknown) {
  const chart = new Chart(new App(), "postgres", { namespace: "test" });
  create(chart);
  return chart.toJson().find((object) => object.kind === "postgresql");
}

function parametersOf(create: (chart: Chart) => unknown): unknown {
  return clusterOf(create)?.spec?.postgresql?.parameters;
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

describe("single-app PostgreSQL storageClass", () => {
  it.each(["golink", "flags", "new-service"])(
    "provisions %s on compressed zfs-ssd-lz4 by default",
    (app) => {
      const cluster = clusterOf((chart) =>
        createSingleAppPostgreSQL(chart, { app, userFlags: [] }),
      );
      expect(cluster?.spec?.volume?.storageClass).toBe(NVME_STORAGE_CLASS_LZ4);
    },
  );

  it.each([...GRANDFATHERED_ZFS_SSD_POSTGRES_APPS])(
    "preserves immutable zfs-ssd storageClass for live cluster %s",
    (app) => {
      const cluster = clusterOf((chart) =>
        createSingleAppPostgreSQL(chart, { app, userFlags: [] }),
      );
      expect(cluster?.spec?.volume?.storageClass).toBe(NVME_STORAGE_CLASS);
    },
  );
});
