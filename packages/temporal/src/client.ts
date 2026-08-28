import { Client, Connection } from "@temporalio/client";
import { parseTemporalBootstrap } from "#shared/temporal-bootstrap.ts";
import { parseTemporalBootstrapMetadata } from "./shared/execution-metadata.ts";
import { ExecutionMetadataClientInterceptor } from "./lib/execution-metadata-client-interceptor.ts";

const DEFAULT_ADDRESS = "temporal-server.temporal.svc.cluster.local:7233";

let cachedClient: Client | undefined;

export async function createTemporalClient(): Promise<Client> {
  if (cachedClient !== undefined) {
    return cachedClient;
  }

  const address = Bun.env["TEMPORAL_ADDRESS"] ?? DEFAULT_ADDRESS;
  const bootstrap = parseTemporalBootstrap(Bun.env);
  const connection = await Connection.connect({ address });
  const bootstrapMetadata = parseTemporalBootstrapMetadata(
    Bun.env["ENVIRONMENT"],
    Bun.env["GIT_SHA"],
  );
  cachedClient = new Client({
    connection,
    namespace: bootstrap.namespace,
    interceptors: {
      workflow: [new ExecutionMetadataClientInterceptor(bootstrapMetadata)],
    },
  });
  return cachedClient;
}
