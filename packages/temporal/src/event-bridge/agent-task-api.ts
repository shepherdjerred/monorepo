import { timingSafeEqual } from "node:crypto";
import type { Client } from "@temporalio/client";
import * as Sentry from "@sentry/bun";
import { Hono } from "hono";
import { ZodError } from "zod/v4";
import { startOrScheduleAgentTask } from "#lib/agent-task-scheduler.ts";
import { AgentTaskInputSchema } from "#shared/agent-task.ts";

const COMPONENT = "agent-task-api";
const DEFAULT_PORT = 9467;

export type AgentTaskApiHandle = {
  port: number;
  close: () => Promise<void>;
};

type StartFn = typeof startOrScheduleAgentTask;

function jsonLog(
  level: "info" | "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  console.warn(
    JSON.stringify({
      level,
      msg: message,
      component: COMPONENT,
      ...fields,
    }),
  );
}

function bearerToken(header: string | undefined): string | undefined {
  if (header === undefined) {
    return undefined;
  }
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) {
    return undefined;
  }
  return header.slice(prefix.length);
}

function bearerMatches(
  presented: string | undefined,
  expected: string,
): boolean {
  if (presented === undefined) {
    return false;
  }
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export function buildAgentTaskApiApp(
  token: string,
  client: Client,
  startTask: StartFn = startOrScheduleAgentTask,
): Hono {
  const app = new Hono();

  app.get("/healthz", (c) => c.text("ok\n"));

  app.post("/agent-tasks", async (c) => {
    if (!bearerMatches(bearerToken(c.req.header("authorization")), token)) {
      jsonLog("warning", "Rejected unauthorized agent task request");
      return c.text("unauthorized\n", 401);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.text("bad json\n", 400);
    }

    let input;
    try {
      input = AgentTaskInputSchema.parse(body);
    } catch (error: unknown) {
      if (error instanceof ZodError) {
        return c.json({ error: "bad payload", issues: error.issues }, 400);
      }
      throw error;
    }

    try {
      const result = await startTask(client, input);
      jsonLog("info", "Scheduled agent task via API", {
        title: input.title,
        result,
      });
      return c.json(result, 202);
    } catch (error: unknown) {
      Sentry.withScope((scope) => {
        scope.setTag("component", COMPONENT);
        scope.setContext("agentTaskApi", {
          title: input.title,
          provider: input.provider,
          cron: input.cron,
          runAt: input.runAt,
        });
        Sentry.captureException(error);
      });
      jsonLog("error", "Failed to schedule agent task", {
        title: input.title,
        error: error instanceof Error ? error.message : String(error),
      });
      return c.text("schedule failed\n", 500);
    }
  });

  return app;
}

export function startAgentTaskApi(client: Client): AgentTaskApiHandle {
  const token = Bun.env["AGENT_TASK_API_TOKEN"];
  if (token === undefined || token === "") {
    throw new Error("AGENT_TASK_API_TOKEN environment variable is required");
  }
  const port = Number.parseInt(
    Bun.env["AGENT_TASK_API_PORT"] ?? String(DEFAULT_PORT),
    10,
  );
  const app = buildAgentTaskApiApp(token, client);
  const server = Bun.serve({
    port,
    hostname: "0.0.0.0",
    fetch: app.fetch,
  });

  jsonLog("info", "Agent task API server started", { port });

  return {
    port,
    async close() {
      await server.stop();
      jsonLog("info", "Agent task API server stopped");
    },
  };
}
