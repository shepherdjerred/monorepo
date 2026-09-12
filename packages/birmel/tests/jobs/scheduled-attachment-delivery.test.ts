import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import {
  runWithRequestContext,
  stageAttachment,
  type RequestContext,
} from "@shepherdjerred/birmel/agent-tools/tools/request-context.ts";
import { resetConfig } from "@shepherdjerred/birmel/config/index.ts";
import { prisma } from "@shepherdjerred/birmel/database/index.ts";
import {
  runAgentJobById,
  setAgentJobRuntimeDependencies,
} from "@shepherdjerred/birmel/scheduler/jobs/agent-jobs.ts";
import { parseJsonRecord } from "@shepherdjerred/birmel/utils/errors.ts";

const ACTOR_USER_ID = "186665676134547461";
const GUILD_ID = "987654321098765432";
const CHANNEL_ID = "876543210987654321";
const SOURCE_MESSAGE_ID = "765432109876543210";

const requestContext: RequestContext = {
  guildId: GUILD_ID,
  userId: ACTOR_USER_ID,
  sourceChannelId: CHANNEL_ID,
  sourceMessageId: SOURCE_MESSAGE_ID,
  ownsSourceReply: false,
};

const previousTrustedUserIds = Bun.env["TRUSTED_USER_IDS"];
const previousMockDelivery = Bun.env["BIRMEL_MOCK_DISCORD_DELIVERY"];

async function createDueAgentJob(prompt: string): Promise<string> {
  const job = await prisma.agentJob.create({
    data: {
      guildId: GUILD_ID,
      channelId: CHANNEL_ID,
      sourceChannelId: CHANNEL_ID,
      sourceMessageId: SOURCE_MESSAGE_ID,
      actorUserId: ACTOR_USER_ID,
      payloadKind: "agent",
      agentPrompt: prompt,
      scheduleKind: "at",
      scheduleValue: new Date(Date.now() - 1000).toISOString(),
      status: "active",
      nextRunAt: new Date(Date.now() - 1000),
    },
  });
  return job.id;
}

beforeAll(() => {
  Bun.env["TRUSTED_USER_IDS"] = JSON.stringify([ACTOR_USER_ID]);
  Bun.env["BIRMEL_MOCK_DISCORD_DELIVERY"] = "true";
  resetConfig();
});

beforeEach(async () => {
  setAgentJobRuntimeDependencies(null);
  await prisma.agentJobRun.deleteMany();
  await prisma.agentJob.deleteMany();
});

afterEach(() => {
  setAgentJobRuntimeDependencies(null);
});

afterAll(() => {
  if (previousTrustedUserIds === undefined) {
    delete Bun.env["TRUSTED_USER_IDS"];
  } else {
    Bun.env["TRUSTED_USER_IDS"] = previousTrustedUserIds;
  }
  if (previousMockDelivery === undefined) {
    delete Bun.env["BIRMEL_MOCK_DISCORD_DELIVERY"];
  } else {
    Bun.env["BIRMEL_MOCK_DISCORD_DELIVERY"] = previousMockDelivery;
  }
  resetConfig();
});

// generate-image stages its result into the request context rather than
// sending it, and a job's turn runs against a cloned context. Delivery used to
// be handed the outer context, so an image a scheduled job produced was
// generated, billed, and then silently dropped.
describe("scheduled agent job attachment delivery", () => {
  test("delivers an attachment staged during the job's turn", async () => {
    // deliverMessage is deliberately left at its default so this covers the
    // real delivery path rather than a stub.
    setAgentJobRuntimeDependencies({
      executeAgent: async () => {
        stageAttachment({
          data: Buffer.from("png-bytes"),
          name: "birmel-1.png",
          description: "today's headlines",
        });
        return { message: "here are the headlines" };
      },
    });
    const jobId = await createDueAgentJob("post the headlines");

    await runAgentJobById(jobId);

    const run = await prisma.agentJobRun.findFirstOrThrow({ where: { jobId } });
    // A null output would mean the run never reached delivery, so assert it
    // before the fallback hides the difference.
    expect(run.output).not.toBeNull();
    expect(parseJsonRecord(run.output ?? "{}")).toMatchObject({
      delivery: { success: true, attachmentCount: 1 },
    });
  });

  test("delivers no attachments when the turn staged none", async () => {
    setAgentJobRuntimeDependencies({
      executeAgent: async () => ({ message: "here are the headlines" }),
    });
    const jobId = await createDueAgentJob("post the headlines");

    await runAgentJobById(jobId);

    const run = await prisma.agentJobRun.findFirstOrThrow({ where: { jobId } });
    expect(parseJsonRecord(run.output ?? "{}")).toMatchObject({
      delivery: { success: true, attachmentCount: 0 },
    });
  });

  // The outer context must not accumulate the turn's attachments, or a later
  // run of the same job would redeliver them.
  test("does not leak staged attachments into the job's stored context", async () => {
    setAgentJobRuntimeDependencies({
      executeAgent: async (_prompt, execution) => {
        stageAttachment({ data: Buffer.from("png"), name: "birmel-1.png" });
        expect(execution.requestContext.stagedAttachments).toHaveLength(1);
        return { message: "done" };
      },
    });
    const jobId = await createDueAgentJob("post the headlines");

    await runWithRequestContext(requestContext, async () => {
      await runAgentJobById(jobId);
    });

    expect(requestContext.stagedAttachments).toBeUndefined();
  });
});
