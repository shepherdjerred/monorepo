import { Client, Connection } from "@temporalio/client";
import { createTemporalClientTracingInterceptor } from "@shepherdjerred/temporal-observability/interceptors";
import {
  type AnyTemporalNamespace,
  parseAnyTemporalNamespace,
} from "#shared/temporal-namespace.ts";
import type { WorkflowVisibilityClient } from "#shared/workflow-visibility-client.ts";
import { parseTemporalBootstrapMetadata } from "./shared/execution-metadata.ts";
import { ExecutionMetadataClientInterceptor } from "./lib/execution-metadata-client-interceptor.ts";

const DEFAULT_ADDRESS = "temporal-server.temporal.svc.cluster.local:7233";

const cachedClients = new Map<AnyTemporalNamespace, Client>();
const cachedVisibilityClients = new Map<AnyTemporalNamespace, Client>();

export async function createTemporalClient(
  namespace: AnyTemporalNamespace = parseAnyTemporalNamespace(
    Bun.env["TEMPORAL_NAMESPACE"],
  ),
): Promise<Client> {
  const cachedClient = cachedClients.get(namespace);
  if (cachedClient !== undefined) {
    return cachedClient;
  }

  const address = Bun.env["TEMPORAL_ADDRESS"] ?? DEFAULT_ADDRESS;
  const connection = await Connection.connect({ address });
  const bootstrapMetadata = parseTemporalBootstrapMetadata(
    Bun.env["ENVIRONMENT"],
    Bun.env["GIT_SHA"],
  );
  // worker.ts's main() sets this once at boot from the same
  // temporal-call-graph-tracing decision its own Worker uses, so an Activity
  // that calls createTemporalClient() to start another workflow (e.g.
  // deliverAgentTaskReport -> deliverReportWorkflow) propagates the active
  // trace context into it instead of silently starting a disconnected trace.
  const callGraphTracing = Bun.env["TEMPORAL_CALL_GRAPH_TRACING"] === "true";
  const client = new Client({
    connection,
    namespace,
    interceptors: {
      workflow: [
        new ExecutionMetadataClientInterceptor(bootstrapMetadata),
        ...(callGraphTracing ? [createTemporalClientTracingInterceptor()] : []),
      ],
    },
  });
  cachedClients.set(namespace, client);
  return client;
}

export async function createTemporalVisibilityClient(
  namespace: AnyTemporalNamespace,
): Promise<WorkflowVisibilityClient> {
  const client = await createTemporalReadClient(namespace);
  return { workflow: client.workflow };
}

export async function createTemporalReadClient(
  namespace: AnyTemporalNamespace,
): Promise<Client> {
  const cachedClient = cachedVisibilityClients.get(namespace);
  if (cachedClient !== undefined) {
    return cachedClient;
  }

  const address = Bun.env["TEMPORAL_ADDRESS"] ?? DEFAULT_ADDRESS;
  const connection = await Connection.connect({ address });
  const client = new Client({ connection, namespace });
  cachedVisibilityClients.set(namespace, client);
  return client;
}
