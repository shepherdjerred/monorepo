import { ensureDevServer } from "#lib/screenshot/dev-server.ts";
import { resolvePackage } from "#lib/screenshot/catalog.ts";

/**
 * Start only the package server and keep it attached to this process.
 *
 * The PR runner uses this in a credential-free container, then runs the
 * PinchTab capture client in a separate container. Keeping the two processes
 * separate prevents mutable app code from seeing browser credentials.
 */
export async function screenshotServerCommand(alias: string): Promise<void> {
  const entry = resolvePackage(alias);
  const server = await ensureDevServer(entry, {
    envOverrides: entry.serverEnv,
  });
  console.log(`JPE_SCREENSHOT_SERVER_READY:${server.baseUrl}`);

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      process.removeListener("SIGINT", shutdown);
      process.removeListener("SIGTERM", shutdown);
      void (async () => {
        try {
          await server.stop();
        } finally {
          resolve();
        }
      })();
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}
