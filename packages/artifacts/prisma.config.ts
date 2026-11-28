import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url:
      process.env["DATABASE_URL"] ??
      "postgres://postgres@127.0.0.1:5474/artifacts",
  },
});
