import { describe, expect, mock, test } from "bun:test";
import type { Client } from "@temporalio/client";
import { WorkflowIdConflictPolicy } from "@temporalio/client";
import { buildSleepWebhookApp } from "./sleep-webhook.ts";

const TOKEN = "test-sleep-webhook-token";

type StartOptions = {
  taskQueue: string;
  workflowId: string;
  workflowIdConflictPolicy: WorkflowIdConflictPolicy;
  workflowExecutionTimeout: number;
  args: unknown[];
};

function fakeClient(
  start: (workflowType: string, options: StartOptions) => Promise<unknown>,
): Client {
  const client = Object.create(null);
  client.workflow = { start };
  return client;
}

function makeStartMock() {
  return mock((_workflowType: string, _options: StartOptions) =>
    Promise.resolve(),
  );
}

async function post(
  app: ReturnType<typeof buildSleepWebhookApp>,
  path: "/sleep/music" | "/sleep/ac",
  body: unknown,
  token = TOKEN,
): Promise<Response> {
  return app.fetch(
    new Request(`http://test${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );
}

describe("sleep webhook", () => {
  test("keeps health checks unauthenticated", async () => {
    const start = makeStartMock();
    const app = buildSleepWebhookApp(TOKEN, fakeClient(start));

    const response = await app.fetch(new Request("http://test/healthz"));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok\n");
    expect(start).not.toHaveBeenCalled();
  });

  test("rejects missing and incorrect bearer tokens", async () => {
    const start = makeStartMock();
    const app = buildSleepWebhookApp(TOKEN, fakeClient(start));

    const missingToken = await app.fetch(
      new Request("http://test/sleep/music", {
        method: "POST",
        body: JSON.stringify({ duration_hours: 2 }),
      }),
    );
    const incorrectToken = await post(
      app,
      "/sleep/music",
      { duration_hours: 2 },
      "wrong-token",
    );

    expect(missingToken.status).toBe(401);
    expect(incorrectToken.status).toBe(401);
    expect(start).not.toHaveBeenCalled();
  });

  test("converts hours to rounded minutes and starts music", async () => {
    const start = makeStartMock();
    const app = buildSleepWebhookApp(TOKEN, fakeClient(start));

    const response = await post(app, "/sleep/music", { duration_hours: 2.5 });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      workflowId: "sleep-music",
      durationMinutes: 150,
    });
    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0]).toEqual([
      "sleepMusic",
      {
        taskQueue: "default",
        workflowId: "sleep-music",
        workflowIdConflictPolicy: WorkflowIdConflictPolicy.TERMINATE_EXISTING,
        workflowExecutionTimeout: 12_600_000,
        args: [{ durationMinutes: 150 }],
      },
    ]);
  });

  test("starts AC with a rounded fractional-hour duration", async () => {
    const start = makeStartMock();
    const app = buildSleepWebhookApp(TOKEN, fakeClient(start));

    const response = await post(app, "/sleep/ac", { duration_hours: 1.25 });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      workflowId: "sleep-ac",
      durationMinutes: 75,
    });
    expect(start.mock.calls[0]?.[0]).toBe("sleepAc");
    expect(start.mock.calls[0]?.[1]).toMatchObject({
      workflowId: "sleep-ac",
      workflowExecutionTimeout: 8_100_000,
      args: [{ durationMinutes: 75 }],
    });
  });

  test("retriggering uses the same workflow ID and new timer", async () => {
    const start = makeStartMock();
    const app = buildSleepWebhookApp(TOKEN, fakeClient(start));

    await post(app, "/sleep/music", { duration_hours: 3 });
    await post(app, "/sleep/music", { duration_hours: 0.5 });

    expect(start).toHaveBeenCalledTimes(2);
    expect(start.mock.calls[1]?.[1]).toMatchObject({
      workflowId: "sleep-music",
      workflowExecutionTimeout: 5_400_000,
      args: [{ durationMinutes: 30 }],
    });
  });

  test("rejects malformed JSON and invalid rounded durations", async () => {
    const start = makeStartMock();
    const app = buildSleepWebhookApp(TOKEN, fakeClient(start));

    const malformed = await app.fetch(
      new Request("http://test/sleep/music", {
        method: "POST",
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "content-type": "application/json",
        },
        body: "not-json",
      }),
    );
    expect(malformed.status).toBe(400);

    for (const durationHours of [0, -1, 0.001, 24.01, "not-a-number"]) {
      const response = await post(app, "/sleep/ac", {
        duration_hours: durationHours,
      });
      expect(response.status).toBe(400);
    }
    expect(start).not.toHaveBeenCalled();
  });

  test("returns 500 when Temporal cannot start the workflow", async () => {
    const start = mock(async () => {
      throw new Error("Temporal unavailable");
    });
    const app = buildSleepWebhookApp(TOKEN, fakeClient(start));

    const response = await post(app, "/sleep/music", { duration_hours: 2 });

    expect(response.status).toBe(500);
    expect(await response.text()).toBe("workflow start failed\n");
  });
});
