import { authFromEnv } from "./auth.ts";
import { createFlagsApp } from "./app.ts";
import { importDeploymentDocuments } from "./import-flipt.ts";
import { FlagStore } from "./store.ts";

const peers = new WeakMap<Request, string | null>();

function peerAddress(request: Request): string | null {
  return peers.get(request) ?? null;
}

export async function startServer(port: number, hostname: string) {
  const databasePath = Bun.env["FLAGS_DATABASE_PATH"] ?? ":memory:";
  const store = FlagStore.open(databasePath);
  const fliptUrl = Bun.env["FLAGS_FLIPT_URL"];
  const seeded =
    fliptUrl === undefined || fliptUrl.length === 0
      ? store.seedFromInventory()
      : store.seedDocuments(await importDeploymentDocuments(fliptUrl));
  console.warn(
    JSON.stringify({
      message: "flag inventory seed",
      service: "flags",
      seeded: seeded.seeded,
      unread: store.unreadDocuments(),
    }),
  );
  const clientRoot = `${import.meta.dir}/../dist/client`;
  const auth = authFromEnv();
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
  console.warn(`flags listening on :${String(server.port)}`);
  return server;
}
