import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { z } from "zod";

import { argumentValue, evalDatabasePath } from "#lib/cli.ts";
import { createEvalStore } from "#server/store.ts";
import type { AppRouter } from "#server/trpc.ts";

const OptionsSchema = z.strictObject({
  databasePath: z.string().min(1),
  datasetId: z.string().min(1),
  serverUrl: z.url(),
});

const options = OptionsSchema.parse({
  databasePath: evalDatabasePath(),
  datasetId: argumentValue("--dataset"),
  serverUrl: argumentValue("--server") ?? Bun.env["SCOUT_EVAL_REMOTE_URL"],
});

const store = createEvalStore(options.databasePath);
try {
  const transfer = store.exportDraft(options.datasetId);
  const client = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({ url: new URL("/trpc", options.serverUrl).toString() }),
    ],
  });
  const summary = await client.datasets.pushDraft.mutate(transfer);
  console.warn(
    `Pushed draft ${summary.key} v${String(summary.version)} ` +
      `(${summary.id}) to ${options.serverUrl}: ` +
      `${String(summary.caseCount)} cases now on the server`,
  );
} finally {
  store.close();
}
