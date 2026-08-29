import { Client, Connection } from "@temporalio/client";
import {
  type AnyTemporalNamespace,
  parseTemporalNamespace,
  type TemporalNamespace,
} from "#shared/temporal-namespace.ts";
import type { WorkflowVisibilityClient } from "#shared/workflow-visibility-client.ts";

const DEFAULT_ADDRESS = "temporal-server.temporal.svc.cluster.local:7233";

const cachedClients = new Map<TemporalNamespace, Client>();
const cachedVisibilityClients = new Map<AnyTemporalNamespace, Client>();

export async function createTemporalClient(
  namespace: TemporalNamespace = parseTemporalNamespace(
    Bun.env["TEMPORAL_NAMESPACE"],
  ),
): Promise<Client> {
  const cachedClient = cachedClients.get(namespace);
  if (cachedClient !== undefined) {
    return cachedClient;
  }

  const address = Bun.env["TEMPORAL_ADDRESS"] ?? DEFAULT_ADDRESS;
  const connection = await Connection.connect({ address });
  const client = new Client({ connection, namespace });
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
