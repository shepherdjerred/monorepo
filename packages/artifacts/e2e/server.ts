/**
 * The Playwright webServer: `bun e2e/server.ts <appPort>`. It serves the built
 * SPA (`dist/client`, or a placeholder page when the build is missing) next to
 * the in-memory fake of the service and seeds nothing; specs seed through
 * `e2e/seed.ts`.
 */
import { z } from "zod";
import { startE2eServer } from "./start.ts";

const port = z.coerce.number().int().min(0).max(65_535).parse(process.argv[2]);
const server = startE2eServer(port);
console.warn(`Artifacts acceptance server on ${server.appOrigin}`);

async function shutdown(): Promise<void> {
  await server.stop();
  process.exit(0);
}
process.once("SIGTERM", () => {
  void shutdown();
});
process.once("SIGINT", () => {
  void shutdown();
});
