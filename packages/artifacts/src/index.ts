import { startServer } from "./server/server.ts";

startServer(Number(Bun.env["PORT"] ?? "7440"), Bun.env["HOST"] ?? "0.0.0.0");
