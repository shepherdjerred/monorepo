import { afterAll, beforeAll, expect, it } from "vitest";
import { z } from "zod";
import { agentHeaders } from "#testing/client.ts";
import {
  startInProcessService,
  type InProcessService,
} from "#testing/service.ts";

let service: InProcessService;
beforeAll(async () => {
  service = await startInProcessService({ settleMs: 50 });
}, 60_000);
afterAll(async () => {
  await service.stop();
});

it("serves the agent and human paths, with SSE, over one in-process service", async () => {
  const headers = {
    ...agentHeaders("harness"),
    "Content-Type": "application/json",
  };
  const created = await service.fetchAsAgent(
    `${service.baseUrl}/trpc/boards.create`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ slug: "harness", title: "Harness" }),
    },
  );
  // Agents are not the browser path: this is a plain agent request and succeeds.
  expect(created.status).toBe(200);
  const stream = await service.fetchAsAgent(
    `${service.baseUrl}/api/feedback/stream?board=harness`,
    { headers },
  );
  expect(stream.headers.get("Content-Type")).toContain("text/event-stream");
  const reader = stream.body?.getReader();
  const first = await reader?.read();
  expect(new TextDecoder().decode(first?.value)).toContain("event: ready");
  await reader?.cancel();
  const human = await service.fetchAsHuman("/trpc/boards.list");
  expect(human.status).toBe(200);
  const body = z
    .object({
      result: z.object({ data: z.array(z.object({ slug: z.string() })) }),
    })
    .parse(await human.json());
  expect(body.result.data.map((board) => board.slug)).toContain("harness");
});
