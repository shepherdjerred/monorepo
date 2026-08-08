import type { PrismaClient } from "#generated/prisma/client/index.js";
import { TurnInputSchema } from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import type { MessageHandler } from "@shepherdjerred/birmel/discord/events/message-create.ts";
import type { FlowScenario } from "./contracts.ts";

export type FlowMessageState = {
  scenario: FlowScenario;
  replyCalls: number;
  replyPayloads: string[];
  editAttempts: string[];
  deliveredEdits: string[];
  deliveryOrder: string[];
};

export function createFlowMessageContext(
  options: { messageId: string; channelId?: string; content?: string },
  state: FlowMessageState,
) {
  const channelId = options.channelId ?? "33333333333333333";
  const content = options.content ?? `request ${options.messageId}`;
  const responseMessageId = `response-${options.messageId}`;
  const activeSessionId =
    state.scenario === "session-persistence-failure"
      ? "session-persistence-failure"
      : state.scenario === "queued-session-inactive"
        ? "queued-session"
        : undefined;
  const message = {
    id: options.messageId,
    reply: (payload: string) => {
      state.replyCalls += 1;
      state.replyPayloads.push(payload);
      state.deliveryOrder.push(`reply:${options.messageId}`);
      if (state.scenario === "placeholder-failure") {
        return Promise.reject(new Error("PLACEHOLDER_SECRET_EXCEPTION"));
      }
      return Promise.resolve({
        id: responseMessageId,
        edit: (editedPayload: string) => {
          state.editAttempts.push(editedPayload);
          state.deliveryOrder.push(`edit:${options.messageId}`);
          if (state.scenario === "final-delivery-failure") {
            return Promise.reject(new Error("DELIVERY_SECRET_EXCEPTION"));
          }
          state.deliveredEdits.push(editedPayload);
          return Promise.resolve();
        },
      });
    },
  };
  const turn = TurnInputSchema.parse({
    discordMessageId: options.messageId,
    guildId: "22222222222222222",
    channelId,
    ...(activeSessionId == null ? {} : { threadId: channelId }),
    userId: "44444444444444444",
    username: "flow-user",
    content,
    attachments: [],
    triggerKind: activeSessionId == null ? "mention" : "session-thread",
    receivedAt: new Date("2026-08-08T12:00:00.000Z"),
  });
  return {
    message,
    turn,
    ...(activeSessionId == null ? {} : { activeSessionId }),
  };
}

export async function invokeFlowHandler(
  handler: MessageHandler,
  context: ReturnType<typeof createFlowMessageContext>,
): Promise<void> {
  const result: unknown = Reflect.apply(handler, undefined, [context]);
  await Promise.resolve(result);
}

export async function waitForAgentRunAdmission(
  prisma: PrismaClient,
  discordMessageId: string,
): Promise<void> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const run = await prisma.agentRun.findUnique({
      where: { discordMessageId },
      select: { status: true },
    });
    if (run?.status === "admitted") {
      await Bun.sleep(0);
      return;
    }
    await Bun.sleep(1);
  }
  throw new Error("Timed out waiting for queued AgentRun admission");
}

export async function waitForFirstFlowPlaceholder(
  state: FlowMessageState,
): Promise<void> {
  const deadline = Date.now() + 2000;
  while (state.replyCalls === 0 && Date.now() < deadline) {
    await Bun.sleep(1);
  }
  if (state.replyCalls === 0) {
    throw new Error("Timed out waiting for the first queued placeholder");
  }
}
