import { defineConfig } from "prisma/config";

function fileUrl(path: string): string {
  return path.startsWith("file:") ? path : `file:${path}`;
}

const databaseUrl =
  process.env["DATABASE_URL"] ??
  fileUrl(process.env["DATABASE_PATH"] ?? "./data/leaderboard.db");

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: databaseUrl,
  },
});
