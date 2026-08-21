import { defineConfig } from "prisma/config";

// The default matches the shared local dev server managed by
// src/testing/postgres-server.ts (port 5471, SCOUT_PG_PORT to override) and
// the scout_dev_3000 database dev-web.ts creates for the default backend port.
const devPort = process.env["SCOUT_PG_PORT"] ?? "5471";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url:
      process.env["DATABASE_URL"] ??
      `postgres://scout@127.0.0.1:${devPort}/scout_dev_3000`,
  },
});
