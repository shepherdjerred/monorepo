import type { Chart } from "cdk8s";
import { PostgresqlSpecUsers } from "@shepherdjerred/homelab/cdk8s/generated/imports/acid.zalan.do";
import { createSingleAppPostgreSQL } from "./single-app-postgresql.ts";

// Bugsink stores error events, stack traces, and metadata; its live database
// is only ~1-2Gi.
export function createBugsinkPostgreSQLDatabase(chart: Chart) {
  return createSingleAppPostgreSQL(chart, {
    app: "bugsink",
    userFlags: [PostgresqlSpecUsers.CREATEDB],
  });
}
