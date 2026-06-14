import { manageAgentSessionTool } from "@shepherdjerred/birmel/agent-tools/tools/sessions/index.ts";
import { browserAutomationTool } from "@shepherdjerred/birmel/agent-tools/tools/automation/browser.ts";
import { webResearchTool } from "@shepherdjerred/birmel/agent-tools/tools/external/research.ts";
import { manageMemoryTool } from "@shepherdjerred/birmel/agent-tools/tools/memory/index.ts";
import { createAgentJob } from "@shepherdjerred/birmel/agent-tools/tools/automation/agent-job-actions.ts";
import { runAgentJobsJob } from "@shepherdjerred/birmel/scheduler/jobs/agent-jobs.ts";
import { prisma } from "@shepherdjerred/birmel/database/index.ts";

type ToolLike = {
  execute: (input: Record<string, unknown>) => Promise<unknown>;
};

function getExecutableTool(tool: unknown): ToolLike {
  if (tool == null || typeof tool !== "object" || !("execute" in tool)) {
    throw new TypeError("Tool is not executable");
  }
  const execute = tool.execute;
  if (typeof execute !== "function") {
    throw new TypeError("Tool execute is not a function");
  }
  return {
    execute: async (input) => {
      const output: unknown = await Reflect.apply(execute, undefined, [input]);
      return output;
    },
  };
}

function expectSuccess(value: unknown, label: string): void {
  if (value == null || typeof value !== "object" || !("success" in value)) {
    throw new Error(`${label} did not return a success field`);
  }
  if (value.success !== true) {
    throw new Error(`${label} failed: ${JSON.stringify(value)}`);
  }
}

function startMockServer() {
  return Bun.serve({
    port: 9867,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/page") {
        return new Response(
          '<html><head><title>Mock Page</title></head><body><a href="/next">Next</a><main>mock body text</main></body></html>',
          { headers: { "content-type": "text/html" } },
        );
      }
      if (url.pathname === "/profiles") {
        return Response.json([{ name: "birmel-e2e" }]);
      }
      if (url.pathname === "/profiles/birmel-e2e/start") {
        return Response.json({ instanceId: "instance-1" });
      }
      if (url.pathname === "/instances/instance-1/tabs/open") {
        return Response.json({ tabId: "tab-1" });
      }
      if (url.pathname === "/instances/instance-1/tabs") {
        return Response.json([
          { id: "tab-1", url: "http://localhost:9867/page" },
        ]);
      }
      if (url.pathname === "/tabs/tab-1/navigate") {
        return Response.json({ ok: true, url: "http://localhost:9867/page" });
      }
      if (url.pathname === "/tabs/tab-1/text") {
        return Response.json({ text: "mock body text" });
      }
      if (url.pathname === "/tabs/tab-1/snapshot") {
        return Response.json({ text: "mock snapshot text" });
      }
      if (url.pathname === "/tabs/tab-1/cookies") {
        return Response.json([{ name: "session", value: "readonly" }]);
      }
      if (url.pathname === "/tabs/tab-1/action") {
        return Response.json({ ok: true });
      }
      if (url.pathname === "/tabs/tab-1/close") {
        return Response.json({ ok: true });
      }
      return new Response("not found", { status: 404 });
    },
  });
}

async function setupPhase(): Promise<void> {
  const memoryTool = getExecutableTool(manageMemoryTool);
  const sessionTool = getExecutableTool(manageAgentSessionTool);
  const browserTool = getExecutableTool(browserAutomationTool);
  const researchTool = getExecutableTool(webResearchTool);

  expectSuccess(
    await memoryTool.execute({
      action: "add",
      guildId: "guild-1",
      scope: "session",
      sessionId: "session-anchor",
      memory: "persistent docker e2e memory",
      tags: ["docker", "e2e"],
      salience: 0.9,
    }),
    "memory add",
  );
  expectSuccess(
    await sessionTool.execute({
      action: "create",
      guildId: "guild-1",
      channelId: "channel-1",
      threadId: "thread-1",
      userId: "user-1",
      label: "docker e2e",
      model: "gpt-5.5",
      reasoningEffort: "medium",
      textVerbosity: "low",
    }),
    "session create",
  );
  const session = await prisma.agentSession.findFirstOrThrow();
  expectSuccess(
    await sessionTool.execute({
      action: "steer",
      guildId: "guild-1",
      sessionId: session.id,
      content: "prefer concise status with evidence",
    }),
    "session steer",
  );
  expectSuccess(
    await browserTool.execute({ action: "start", profile: "birmel-e2e" }),
    "pinchtab start",
  );
  expectSuccess(
    await browserTool.execute({
      action: "open",
      instanceId: "instance-1",
      url: "http://localhost:9867/page",
    }),
    "pinchtab open",
  );
  expectSuccess(
    await browserTool.execute({
      action: "navigate",
      tabId: "tab-1",
      url: "http://localhost:9867/page",
    }),
    "pinchtab navigate",
  );
  expectSuccess(
    await browserTool.execute({ action: "get-text", tabId: "tab-1" }),
    "pinchtab text",
  );
  expectSuccess(
    await researchTool.execute({
      action: "fetch",
      url: "http://localhost:9867/page",
    }),
    "web fetch",
  );
  await createAgentJob({
    guildId: "guild-1",
    userId: "user-1",
    channelId: "channel-1",
    threadId: "thread-1",
    scheduleKind: "every",
    scheduleValue: "1s",
    timezone: "UTC",
    toolId: undefined,
    toolInput: undefined,
    message: "docker e2e scheduled message",
    name: "docker e2e job",
    description: "persistent restart job",
    maxAttempts: 2,
    timeoutMs: 30_000,
    model: "gpt-5.5",
    reasoningEffort: "medium",
    textVerbosity: "low",
  });
}

async function verifyPhase(): Promise<void> {
  const memoryCount = await prisma.agentMemory.count({
    where: { content: { contains: "persistent docker e2e memory" } },
  });
  const sessionCount = await prisma.agentSession.count({
    where: { label: "docker e2e" },
  });
  const job = await prisma.agentJob.findFirstOrThrow({
    where: { name: "docker e2e job" },
  });
  if (memoryCount !== 1 || sessionCount !== 1) {
    throw new Error("Persisted memory/session state did not survive restart");
  }
  await new Promise((resolve) => setTimeout(resolve, 1200));
  await runAgentJobsJob();
  const runs = await prisma.agentJobRun.findMany({
    where: { jobId: job.id },
    orderBy: { startedAt: "desc" },
  });
  if (runs.length === 0 || runs[0]?.status !== "success") {
    throw new Error(
      `Expected successful persisted job run, got ${JSON.stringify(runs)}`,
    );
  }
}

const phase = Bun.argv[2] ?? "setup";
const server = startMockServer();
try {
  if (phase === "setup") {
    await setupPhase();
  } else if (phase === "verify") {
    await verifyPhase();
  } else {
    throw new Error(`Unknown phase: ${phase}`);
  }
} finally {
  await server.stop(true);
  await prisma.$disconnect();
}
