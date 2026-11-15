import type { Chart } from "cdk8s";
import { PostgresqlSpecUsers } from "@shepherdjerred/homelab/cdk8s/generated/imports/acid.zalan.do";
import { createSingleAppPostgreSQL } from "./single-app-postgresql.ts";

export function createTasknotesPostgreSQLDatabase(chart: Chart) {
  return createSingleAppPostgreSQL(chart, {
    app: "tasknotes",
    userFlags: [PostgresqlSpecUsers.CREATEDB],
  });
}
