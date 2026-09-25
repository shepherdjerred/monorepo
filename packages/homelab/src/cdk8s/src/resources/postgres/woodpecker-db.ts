import type { Chart } from "cdk8s";
import { PostgresqlSpecUsers } from "@shepherdjerred/homelab/cdk8s/generated/imports/acid.zalan.do";
import { createSingleAppPostgreSQL } from "./single-app-postgresql.ts";

/**
 * Backing store for the Woodpecker CI server.
 *
 * Woodpecker keeps pipeline history, step logs, repo registrations, and forge
 * OAuth sessions here. Losing it does not lose any build input — those live in
 * Git and the registries — but it does lose the record of what ran, which the
 * release lanes read back when deciding the last green main commit. It is
 * therefore backed up, unlike the CI caches in this namespace.
 *
 * The server's DSN names the `woodpecker_db` database and `woodpecker` role
 * this produces.
 */
export function createWoodpeckerPostgreSQLDatabase(chart: Chart) {
  return createSingleAppPostgreSQL(chart, {
    app: "woodpecker",
    userFlags: [PostgresqlSpecUsers.CREATEDB],
  });
}
