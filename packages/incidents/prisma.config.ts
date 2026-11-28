import { defineConfig } from "prisma/config";

const config = defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url:
      process.env["INCIDENTS_DATABASE_URL"] ??
      "postgres://postgres@127.0.0.1:5471/incidents",
  },
});

export default config;
