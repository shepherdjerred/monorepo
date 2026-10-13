import { startTestPostgres } from "./src/testing/postgres.ts";

export default async function setup() {
  const cluster = await startTestPostgres();
  Bun.env["TRACKER_TEST_ADMIN_URL"] = cluster.adminUrl;
  return cluster.stop;
}
