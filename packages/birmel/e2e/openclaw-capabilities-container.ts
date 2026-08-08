import { browserAutomationTool } from "@shepherdjerred/birmel/agent-tools/tools/automation/browser.ts";
import { webResearchTool } from "@shepherdjerred/birmel/agent-tools/tools/external/research.ts";
import { createAgentJob } from "@shepherdjerred/birmel/agent-tools/tools/automation/agent-job-actions.ts";
import { runWithRequestContext } from "@shepherdjerred/birmel/agent-tools/tools/request-context.ts";
import { runAgentJobsJob } from "@shepherdjerred/birmel/scheduler/jobs/agent-jobs.ts";
import { prisma } from "@shepherdjerred/birmel/database/index.ts";
import { rememberMemoryClaim } from "@shepherdjerred/birmel/memory/operations.ts";
import {
  appendSessionEvent,
  createSession,
} from "@shepherdjerred/birmel/sessions/service.ts";

const GUILD_ID = "123456789012345678";
const CHANNEL_ID = "223456789012345678";
const THREAD_ID = "323456789012345678";
const USER_ID = "160509172704739328";
const MESSAGE_ID = "423456789012345678";

type ToolLike = {
  execute: (input: Record<string, unknown>) => Promise<unknown>;
};

function getExecutableTool(tool: unknown): ToolLike {
  if (typeof tool !== "object" || tool == null || !("execute" in tool)) {
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
  if (typeof value !== "object" || value == null || !("success" in value)) {
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
  const browserTool = getExecutableTool(browserAutomationTool);
  const researchTool = getExecutableTool(webResearchTool);

  await rememberMemoryClaim(prisma, {
    context: {
      guildId: GUILD_ID,
      channelId: CHANNEL_ID,
      userId: USER_ID,
      personaId: "virmel",
      authorUserId: USER_ID,
      extractorModel: "docker-e2e",
    },
    candidate: {
      scope: "guild",
      subject: "docker e2e",
      predicate: "preference",
      value: "persistent docker e2e memory",
      confidence: 1,
      salience: 0.9,
      origin: "explicit",
      validFrom: null,
      validUntil: null,
      relatedUserIds: [],
      sourceDiscordMessageIds: [MESSAGE_ID],
    },
    embedding: [1, 0],
  });
  const session = await createSession({
    guildId: GUILD_ID,
    channelId: CHANNEL_ID,
    threadId: THREAD_ID,
    actorUserId: USER_ID,
    label: "docker e2e",
  });
  await appendSessionEvent({
    sessionId: session.id,
    role: "user",
    eventType: "message",
    content: "prefer concise status with evidence",
    discordMessageId: MESSAGE_ID,
  });

  await runWithRequestContext(
    {
      guildId: GUILD_ID,
      sourceChannelId: CHANNEL_ID,
      sourceMessageId: MESSAGE_ID,
      userId: USER_ID,
    },
    async () => {
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
      expectSuccess(
        await createAgentJob({
          scheduleKind: "every",
          scheduleValue: "1s",
          timezone: "UTC",
          payload: { kind: "message", message: "docker e2e scheduled message" },
          sessionId: session.id,
          name: "docker e2e job",
          description: "persistent restart job",
          maxAttempts: 2,
          timeoutMs: 30_000,
        }),
        "job create",
      );
    },
  );
}

async function verifyPhase(): Promise<void> {
  const memoryCount = await prisma.memoryClaim.count({
    where: { value: { contains: "persistent docker e2e memory" } },
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
