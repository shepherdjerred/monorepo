import { startServer } from "./server.ts";

await startServer(
  Number(Bun.env["PORT"] ?? "7360"),
  Bun.env["HOST"] ?? "0.0.0.0",
);
