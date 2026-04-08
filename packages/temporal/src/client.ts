import { Client, Connection } from "@temporalio/client";

const DEFAULT_ADDRESS = "temporal-server.temporal.svc.cluster.local:7233";

let cachedClient: Client | undefined;

export async function createTemporalClient(): Promise<Client> {
  if (cachedClient !== undefined) {
    return cachedClient;
  }

  const address = Bun.env["TEMPORAL_ADDRESS"] ?? DEFAULT_ADDRESS;
  const connection = await Connection.connect({ address });
  cachedClient = new Client({ connection });
  return cachedClient;
}
