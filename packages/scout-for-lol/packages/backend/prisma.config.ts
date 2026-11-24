import { defineConfig } from "prisma/config";

// The default matches Scout's durable local dev server managed by
// scripts/ensure-dev-postgres.ts (port 5472, SCOUT_PG_PORT to override) and
// the scout_dev_3000 database dev-web.ts creates for the default backend port.
const devPort = process.env["SCOUT_PG_PORT"] ?? "5472";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url:
      process.env["DATABASE_URL"] ??
      `postgres://scout@127.0.0.1:${devPort}/scout_dev_3000`,
  },
});
