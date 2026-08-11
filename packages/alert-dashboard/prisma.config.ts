import { defineConfig } from "prisma/config";

const databaseUrl =
  process.env["DATABASE_URL"] ?? "file:./data/alert-dashboard.db";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: { url: databaseUrl },
});
