import type { Server } from "bun";
import { reportError } from "#infrastructure/log.ts";
import type { ChangeHub } from "#infrastructure/change-hub.ts";
import type { Bootstrap, Settings } from "#infrastructure/config.ts";
import type { Database } from "#infrastructure/database.ts";
import type { ObjectStore } from "#infrastructure/object-store.ts";
import { createRuntime } from "./runtime.ts";

/** At least a minute, so a slow upload or a quiet stream is never cut off. */
export const IDLE_TIMEOUT_SECONDS = 60;

export async function startServer(options: {
  config: Bootstrap;
  db: Database;
  store: ObjectStore;
  settings: Settings;
  hub: ChangeHub;
}): Promise<{ server: Server<undefined> }> {
  const { config } = options;
  const runtime = await createRuntime({
    db: options.db,
    store: options.store,
    settings: options.settings,
    hub: options.hub,
    appOrigin: config.ARTIFACTS_APP_ORIGIN,
    contentOrigin: config.ARTIFACTS_CONTENT_ORIGIN,
  });
  const server = Bun.serve({
    hostname: config.HOST,
    port: config.PORT,
    // Bun rejects a larger body before it is read. The per-file ceiling is
    // the only request body this service accepts at size.
    maxRequestBodySize: await options.settings.value("maxFileBytes"),
    idleTimeout: IDLE_TIMEOUT_SECONDS,
    fetch: runtime.fetch,
    // The last resort: a failure outside every host's own handler.
    error: (error) => {
      reportError(error, "artifacts_unhandled_error");
      return new Response("Internal Server Error", { status: 500 });
    },
  });
  return { server };
}
