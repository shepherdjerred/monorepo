import { timingSafeEqual } from "node:crypto";
import type { Client } from "@temporalio/client";
import { WorkflowIdConflictPolicy } from "@temporalio/client";
import type { Duration } from "@temporalio/common";
import * as Sentry from "@sentry/bun";
import { Hono } from "hono";
import { z } from "zod/v4";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  SleepDurationMinutesSchema,
  type SleepAutomationInput,
} from "#shared/schemas.ts";

const COMPONENT = "sleep-webhook";
const DEFAULT_PORT = 9469;
const MINUTE_MS = 60_000;
const CLEANUP_BUFFER_MINUTES = 60;
const SLEEP_MUSIC_WORKFLOW_ID = "sleep-music";
const SLEEP_AC_WORKFLOW_ID = "sleep-ac";

const SleepWebhookInputSchema = z
  .object({
    duration_hours: z.union([
      z.number(),
      z
        .string()
        .trim()
        .min(1)
        .refine((value) => Number.isFinite(Number(value)), {
          message: "duration_hours must be numeric",
        })
        .transform(Number),
    ]),
  })
  .strict();

type SleepWorkflowType = "sleepMusic" | "sleepAc";

type StartSleepWorkflow = (
  client: Client,
  workflowType: SleepWorkflowType,
  workflowId: string,
  durationMinutes: number,
) => Promise<void>;

function tokenMatches(
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

function bearerToken(header: string | undefined): string | undefined {
  const prefix = "Bearer ";
  if (header === undefined) {
    return undefined;
  }
  if (!header.startsWith(prefix)) {
    return undefined;
  }
  return header.slice(prefix.length);
}

function sleepWorkflowTimeout(durationMinutes: number): Duration {
  return (durationMinutes + CLEANUP_BUFFER_MINUTES) * MINUTE_MS;
}

function durationMinutesFromHours(hours: number): number | undefined {
  const durationMinutes = Math.round(hours * 60);
  const parsed = SleepDurationMinutesSchema.safeParse(durationMinutes);
  return parsed.success ? parsed.data : undefined;
}

async function startSleepWorkflow(
  client: Client,
  workflowType: SleepWorkflowType,
  workflowId: string,
  durationMinutes: number,
): Promise<void> {
  const input: SleepAutomationInput = { durationMinutes };
  await client.workflow.start(workflowType, {
    taskQueue: TASK_QUEUES.DEFAULT,
    workflowId,
    workflowIdConflictPolicy: WorkflowIdConflictPolicy.TERMINATE_EXISTING,
    workflowExecutionTimeout: sleepWorkflowTimeout(durationMinutes),
    args: [input],
  });
  console.warn(
    JSON.stringify({
      level: "info",
      msg: "Started sleep workflow",
      component: COMPONENT,
      workflowType,
      workflowId,
      durationMinutes,
    }),
  );
}

function jsonLog(
  level: "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  console.warn(
    JSON.stringify({ level, msg: message, component: COMPONENT, ...fields }),
  );
}

export function buildSleepWebhookApp(
  token: string,
  client: Client,
  startWorkflow: StartSleepWorkflow = startSleepWorkflow,
): Hono {
  const app = new Hono();

  app.get("/healthz", (c) => c.text("ok\n"));

  const registerRoute = (
    path: "/sleep/music" | "/sleep/ac",
    workflowType: SleepWorkflowType,
    workflowId: string,
  ): void => {
    app.post(path, async (c) => {
      if (!tokenMatches(bearerToken(c.req.header("authorization")), token)) {
        jsonLog("warning", "Rejected unauthorized sleep webhook");
        return c.text("unauthorized\n", 401);
      }

      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.text("bad json\n", 400);
      }

      const parsedBody = SleepWebhookInputSchema.safeParse(body);
      if (!parsedBody.success) {
        return c.json(
          { error: "bad payload", issues: parsedBody.error.issues },
          400,
        );
      }

      const durationMinutes = durationMinutesFromHours(
        parsedBody.data.duration_hours,
      );
      if (durationMinutes === undefined) {
        return c.json(
          {
            error:
              "duration_hours must round to an integer from 1 to 1440 minutes",
          },
          400,
        );
      }

      try {
        await startWorkflow(client, workflowType, workflowId, durationMinutes);
      } catch (error: unknown) {
        Sentry.captureException(error);
        jsonLog("error", "Failed to start sleep workflow", {
          workflowType,
          workflowId,
          durationMinutes,
          error: error instanceof Error ? error.message : String(error),
        });
        return c.text("workflow start failed\n", 500);
      }

      return c.json({ workflowId, durationMinutes }, 202);
    });
  };

  registerRoute("/sleep/music", "sleepMusic", SLEEP_MUSIC_WORKFLOW_ID);
  registerRoute("/sleep/ac", "sleepAc", SLEEP_AC_WORKFLOW_ID);

  return app;
}

export type SleepWebhookHandle = {
  port: number;
  close: () => Promise<void>;
};

export function startSleepWebhook(client: Client): SleepWebhookHandle {
  const token = Bun.env["SLEEP_WEBHOOK_TOKEN"];
  if (token === undefined || token === "") {
    throw new Error("SLEEP_WEBHOOK_TOKEN environment variable is required");
  }
  const port = Number.parseInt(
    Bun.env["SLEEP_WEBHOOK_PORT"] ?? String(DEFAULT_PORT),
    10,
  );
  const app = buildSleepWebhookApp(token, client);
  const server = Bun.serve({
    port,
    hostname: "0.0.0.0",
    fetch: app.fetch,
  });

  console.warn(
    JSON.stringify({
      level: "info",
      msg: "Sleep webhook server started",
      component: COMPONENT,
      port,
    }),
  );

  return {
    port,
    async close() {
      await server.stop();
      console.warn(
        JSON.stringify({
          level: "info",
          msg: "Sleep webhook server stopped",
          component: COMPONENT,
        }),
      );
    },
  };
}
