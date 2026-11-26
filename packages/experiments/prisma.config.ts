import { env } from "node:process";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url:
      env["DATABASE_URL"] ?? "postgresql://postgres@127.0.0.1:5432/experiments",
  },
});
