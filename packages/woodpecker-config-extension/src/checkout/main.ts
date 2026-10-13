import { z } from "zod";
import path from "node:path";
import { checkoutSource } from "./snapshot.ts";

const [cache, commit] = z
  .tuple([z.string().min(1), z.string()])
  .parse(Bun.argv.slice(2));
const result = await checkoutSource({
  cache:
    Bun.env["CI_SOURCE_CACHE_COLD"] === "true"
      ? path.join(process.cwd(), ".git", "ci-cold-source-cache")
      : cache,
  ...(Bun.env["CI_SOURCE_CACHE_COLD"] === "true" ? { seedCache: cache } : {}),
  commit,
  workspace: process.cwd(),
  repository: "https://github.com/shepherdjerred/monorepo.git",
  incremental: Bun.env["CI_SOURCE_INCREMENTAL"] === "true",
  ...(Bun.env["CI_GRADLE_SEED_IMAGE"] === undefined
    ? {}
    : {
        gradle: {
          root: "/woodpecker/workspace-seeds",
          image: z.string().min(1).parse(Bun.env["CI_GRADLE_SEED_IMAGE"]),
        },
      }),
  ...(Bun.env["CI_PREPARED_PROFILE"] === undefined
    ? {}
    : {
        prepared: {
          root: "/woodpecker/workspace-seeds",
          profile: z
            .enum(["verify", "browser"])
            .parse(Bun.env["CI_PREPARED_PROFILE"]),
          image: z.string().min(1).parse(Bun.env["CI_PREPARED_IMAGE"]),
        },
      }),
});
await Bun.write(
  Bun.stdout,
  `CI_CHECKOUT_DIAGNOSTIC ${JSON.stringify(result)}\n`,
);
