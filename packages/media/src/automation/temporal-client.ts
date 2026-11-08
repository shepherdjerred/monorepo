import {
  Client,
  Connection,
  WorkflowExecutionAlreadyStartedError,
  WorkflowNotFoundError,
} from "@temporalio/client";
import type { WorkflowStarter } from "./store.ts";
import type { MediaAutomationContext } from "./context.ts";

/** A failed connection is not cached; committed outbox entries remain retryable. */
export function createMediaWorkflowStarter(config: {
  address: string;
  namespace: string;
}): {
  start: WorkflowStarter;
  describe: MediaAutomationContext["describeWorkflow"];
  close: () => Promise<void>;
} {
  let connection: Connection | null = null;
  let connecting: Promise<Connection> | null = null;
  async function getConnection(): Promise<Connection> {
    if (connection !== null) return connection;
    connecting ??= Connection.connect({
      address: config.address,
      connectTimeout: "3 seconds",
    });
    try {
      connection = await connecting;
      return connection;
    } finally {
      connecting = null;
    }
  }
  return {
    async describe(workflowId) {
      const connected = await getConnection();
      const client = new Client({
        connection: connected,
        namespace: config.namespace,
      });
      try {
        const description = await connected.withDeadline(
          Date.now() + 5000,
          () => client.workflow.getHandle(workflowId).describe(),
        );
        return { runId: description.runId, status: description.status.name };
      } catch (error) {
        if (error instanceof WorkflowNotFoundError) return null;
        throw error;
      }
    },
    async start(input) {
      const connected = await getConnection();
      const client = new Client({
        connection: connected,
        namespace: config.namespace,
      });
      try {
        await connected.withDeadline(Date.now() + 5000, async () =>
          client.workflow.start(input.workflowType, {
            workflowId: input.workflowId,
            taskQueue: "monorepo-workflows",
            args: [input.input],
            workflowIdReusePolicy: "REJECT_DUPLICATE",
          }),
        );
      } catch (error) {
        if (!(error instanceof WorkflowExecutionAlreadyStartedError))
          throw error;
      }
    },
    async close() {
      if (connecting !== null) {
        try {
          await connecting;
        } catch {
          return;
        }
      }
      if (connection !== null) await connection.close();
    },
  };
}
