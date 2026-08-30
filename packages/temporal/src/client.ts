import { Client, Connection } from "@temporalio/client";
import { parseTemporalBootstrap } from "#shared/temporal-bootstrap.ts";

const DEFAULT_ADDRESS = "temporal-server.temporal.svc.cluster.local:7233";

let cachedClient: Client | undefined;

export async function createTemporalClient(): Promise<Client> {
  if (cachedClient !== undefined) {
    return cachedClient;
  }

  const address = Bun.env["TEMPORAL_ADDRESS"] ?? DEFAULT_ADDRESS;
  const bootstrap = parseTemporalBootstrap(Bun.env);
  const connection = await Connection.connect({ address });
  cachedClient = new Client({
    connection,
    namespace: bootstrap.namespace,
  });
  return cachedClient;
}
