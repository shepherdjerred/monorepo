import { authFromEnv } from "./auth.ts";
import { createFlagsApp, createFlagsEvaluationApp } from "./app.ts";
import { FlagStore } from "./store.ts";

const NON_NEGATIVE_INTEGER = /^(?:0|[1-9]\d*)$/u;
const peers = new WeakMap<Request, string | null>();

function peerAddress(request: Request): string | null {
  return peers.get(request) ?? null;
}

function parseEvaluationPort(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.length === 0) return undefined;
  if (!NON_NEGATIVE_INTEGER.test(raw)) {
    throw new Error(`Invalid FLAGS_EVALUATION_PORT: ${raw}`);
  }
  const parsed = Number(raw);
  if (parsed < 0 || parsed > 65_535 || !Number.isSafeInteger(parsed)) {
    throw new Error(`Invalid FLAGS_EVALUATION_PORT: ${raw}`);
  }
  return parsed;
}

export type FlagsServer = {
  readonly port: number;
  readonly hostname: string | undefined;
  readonly evaluationPort: number | undefined;
  readonly stop: (closeActiveConnections?: boolean) => Promise<void>;
};

export async function startServer(
  port: number,
  hostname: string,
): Promise<FlagsServer> {
  const evaluationPort = parseEvaluationPort(Bun.env["FLAGS_EVALUATION_PORT"]);
  const auth = authFromEnv();
  const databasePath = Bun.env["FLAGS_DATABASE_PATH"] ?? ":memory:";
  const store = FlagStore.open(databasePath);
  try {
    const seeded = store.seedFromInventory();
    console.warn(
      JSON.stringify({
        message: "flag inventory seed",
        service: "flags",
        seeded: seeded.seeded,
        unread: store.unreadDocuments(),
      }),
    );
    const clientRoot = `${import.meta.dir}/../dist/client`;
    const clientReady = await Bun.file(`${clientRoot}/index.html`).exists();
    const app = clientReady
      ? createFlagsApp({ store, auth, peerAddress, clientRoot })
      : createFlagsApp({ store, auth, peerAddress });
    const server = Bun.serve({
      port,
      hostname,
      fetch(request, bunServer) {
        peers.set(request, bunServer.requestIP(request)?.address ?? null);
        return app.fetch(request);
      },
    });
    if (server.port === undefined) {
      await server.stop(true);
      throw new Error("flags server did not bind a TCP port");
    }
    let evaluationServer: ReturnType<typeof Bun.serve> | undefined;
    if (evaluationPort !== undefined) {
      const evaluationApp = createFlagsEvaluationApp({ store });
      try {
        evaluationServer = Bun.serve({
          port: evaluationPort,
          hostname,
          fetch: evaluationApp.fetch,
        });
      } catch (error) {
        await server.stop(true);
        throw error;
      }
      if (evaluationServer.port === undefined) {
        await Promise.all([server.stop(true), evaluationServer.stop(true)]);
        throw new Error("flags evaluation server did not bind a TCP port");
      }
      console.warn(
        `flags evaluation listening on :${String(evaluationServer.port)}`,
      );
    }
    console.warn(`flags listening on :${String(server.port)}`);
    return {
      port: server.port,
      hostname: server.hostname,
      evaluationPort: evaluationServer?.port,
      async stop(closeActiveConnections?: boolean) {
        await Promise.all([
          server.stop(closeActiveConnections),
          evaluationServer?.stop(closeActiveConnections),
        ]);
        store.close();
      },
    };
  } catch (error) {
    store.close();
    throw error;
  }
}
