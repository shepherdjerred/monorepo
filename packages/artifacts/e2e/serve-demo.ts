/**
 * Boots the fake service, seeds it through the upload API and stays up, for
 * manual screenshots and demos: `bun e2e/serve-demo.ts [appPort] [settleMs]`.
 * The port defaults to a free one; settleMs defaults to 0.
 */
import { z } from "zod";
import { seedBoard } from "./seed.ts";
import { startE2eServer } from "./start.ts";

const port = z.coerce
  .number()
  .int()
  .min(0)
  .max(65_535)
  .default(0)
  .parse(process.argv[2]);
const settleMs = z.coerce
  .number()
  .int()
  .min(0)
  .default(0)
  .parse(process.argv[3]);
const server = startE2eServer(port, { settleMs });
const seeded = await seedBoard(server.appOrigin);

console.warn(`App:     ${server.appOrigin}`);
console.warn(`Content: ${server.contentOrigin}`);
console.warn(
  `Boards:  ${server.appOrigin}/b/demo  ${server.appOrigin}/b/concepts`,
);
console.warn(`Focused: ${seeded.demo.html.reviewUrl}`);

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
