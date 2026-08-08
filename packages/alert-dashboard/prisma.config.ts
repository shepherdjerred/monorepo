import { defineConfig } from "prisma/config";

const databaseUrl =
  process.env["DATABASE_URL"] ??
  "postgresql://alert_dashboard:alert_dashboard@127.0.0.1:5432/alert_dashboard";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: { url: databaseUrl },
});
