import { z } from "zod";
import { checkoutSource } from "./snapshot.ts";

const [cache, commit] = z
  .tuple([z.string().min(1), z.string()])
  .parse(Bun.argv.slice(2));
const result = await checkoutSource({
  cache,
  commit,
  workspace: process.cwd(),
  repository: "https://github.com/shepherdjerred/monorepo.git",
});
await Bun.write(
  Bun.stdout,
  `CI_CHECKOUT_DIAGNOSTIC ${JSON.stringify(result)}\n`,
);
