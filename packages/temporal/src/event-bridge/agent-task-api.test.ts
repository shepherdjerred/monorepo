import { describe, expect, it, mock } from "bun:test";
import type { Client } from "@temporalio/client";
import { buildAgentTaskApiApp } from "./agent-task-api.ts";
import type {
  AgentTaskInput,
  AgentTaskStartResult,
} from "#shared/agent-task.ts";

const TOKEN = "test-agent-task-token";

function fakeClient(): Client {
  return Object.create(null);
}

const START_RESULT: AgentTaskStartResult = {
  kind: "workflow",
  workflowId: "agent-task-test",
  runId: "run-id",
};

/** A `start` mock that resolves to the canonical workflow start result. */
function makeStartMock() {
  return mock(
    async (
      _client: Client,
      _input: AgentTaskInput,
    ): Promise<AgentTaskStartResult> => START_RESULT,
  );
}

function validInput(): AgentTaskInput {
  return {
    title: "Check follow-up",
    prompt: "Check whether the follow-up is resolved.",
    provider: "claude",
    mode: "report-only",
    repo: { fullName: "shepherdjerred/monorepo", ref: "main" },
    runAt: "2026-05-31T09:00:00-07:00",
    allowSelfCancel: false,
  };
}

async function postAgentTask(
  app: ReturnType<typeof buildAgentTaskApiApp>,
  input: AgentTaskInput,
  token?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (token !== undefined) {
    headers["authorization"] = `Bearer ${token}`;
  }
  return app.fetch(
    new Request("http://test/agent-tasks", {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    }),
  );
}

describe("buildAgentTaskApiApp", () => {
  it("keeps health checks unauthenticated", async () => {
    const start = makeStartMock();
    const app = buildAgentTaskApiApp(TOKEN, fakeClient(), start);

    const res = await app.fetch(new Request("http://test/healthz"));

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok\n");
    expect(start).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated agent task creation", async () => {
    const start = makeStartMock();
    const app = buildAgentTaskApiApp(TOKEN, fakeClient(), start);

    const res = await postAgentTask(app, validInput());

    expect(res.status).toBe(401);
    expect(await res.text()).toBe("unauthorized\n");
    expect(start).not.toHaveBeenCalled();
  });

  it("rejects a wrong-but-same-length bearer token", async () => {
    const start = makeStartMock();
    const app = buildAgentTaskApiApp(TOKEN, fakeClient(), start);

    const wrongSameLength = "x".repeat(TOKEN.length);
    expect(wrongSameLength.length).toBe(TOKEN.length);
    const res = await postAgentTask(app, validInput(), wrongSameLength);

    expect(res.status).toBe(401);
    expect(await res.text()).toBe("unauthorized\n");
    expect(start).not.toHaveBeenCalled();
  });

  it("schedules authenticated agent task creation", async () => {
    const start = makeStartMock();
    const app = buildAgentTaskApiApp(TOKEN, fakeClient(), start);

    const res = await postAgentTask(app, validInput(), TOKEN);

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual(START_RESULT);
    expect(start).toHaveBeenCalledTimes(1);
  });
});
