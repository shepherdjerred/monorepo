import { OPENAI_RESPONSES_PROVIDER_OPTIONS } from "@shepherdjerred/birmel/voltagent/openai-provider-options.ts";
import { logger } from "@shepherdjerred/birmel/utils/logger.ts";

// Typing cursor for progressive updates
export const TYPING_CURSOR = " \u258C";

// Minimum interval between Discord message edits (ms) to avoid rate limits
const EDIT_INTERVAL_MS = 1500;

// Minimum content length before showing in progressive update
const MIN_CONTENT_LENGTH = 20;

// Hard cap on a single streamText turn. If a sub-agent hangs upstream
// (model stalls, tool deadlock) the user would otherwise stare at a typing
// cursor forever; aborting here surfaces the failure as a visible reply.
const STREAM_TIMEOUT_MS = 60_000;

type StreamTextResponse = {
  textStream: AsyncIterable<string>;
};

type StreamingAgent = {
  streamText: (
    input: string,
    options: {
      userId: string;
      conversationId: string;
      providerOptions: typeof OPENAI_RESPONSES_PROVIDER_OPTIONS;
      abortSignal: AbortSignal;
    },
  ) => Promise<StreamTextResponse>;
};

type EditableMessage = {
  edit: (content: string) => Promise<unknown>;
};

export type StreamAttemptName = "router" | "direct-messaging";

export type StreamAttemptResult = {
  name: StreamAttemptName;
  text: string;
  durationMs: number;
};

export type StreamWithRetryResult = {
  text: string;
  durationMs: number;
  attempts: StreamAttemptResult[];
};

export async function streamAgentResponse(params: {
  agent: StreamingAgent;
  attemptName: StreamAttemptName;
  input: string;
  userId: string;
  conversationId: string;
  placeholderMessage: EditableMessage;
}): Promise<StreamAttemptResult> {
  const attemptStartMs = Date.now();
  let accumulated = "";
  let lastEditTime = Date.now();
  const response = await params.agent.streamText(params.input, {
    userId: params.userId,
    conversationId: params.conversationId,
    providerOptions: OPENAI_RESPONSES_PROVIDER_OPTIONS,
    abortSignal: AbortSignal.timeout(STREAM_TIMEOUT_MS),
  });

  for await (const chunk of response.textStream) {
    accumulated += chunk;

    const now = Date.now();
    if (
      now - lastEditTime >= EDIT_INTERVAL_MS &&
      accumulated.length >= MIN_CONTENT_LENGTH
    ) {
      try {
        await params.placeholderMessage.edit(accumulated + TYPING_CURSOR);
        lastEditTime = now;
      } catch (editError) {
        logger.debug("Failed to edit placeholder message", {
          editError,
          attempt: params.attemptName,
        });
      }
    }
  }

  return {
    name: params.attemptName,
    text: accumulated,
    durationMs: Date.now() - attemptStartMs,
  };
}

export async function streamWithEmptyRetry(params: {
  routerAgent: StreamingAgent;
  directMessagingAgentFactory: () => StreamingAgent;
  input: string;
  userId: string;
  conversationId: string;
  placeholderMessage: EditableMessage;
  requestId: string;
  persona: string;
}): Promise<StreamWithRetryResult> {
  const startMs = Date.now();
  const routerAttempt = await streamAgentResponse({
    agent: params.routerAgent,
    attemptName: "router",
    input: params.input,
    userId: params.userId,
    conversationId: params.conversationId,
    placeholderMessage: params.placeholderMessage,
  });
  if (routerAttempt.text.length > 0) {
    return {
      text: routerAttempt.text,
      durationMs: Date.now() - startMs,
      attempts: [routerAttempt],
    };
  }

  logger.warn(
    "router stream returned empty output; retrying direct messaging",
    {
      requestId: params.requestId,
      persona: params.persona,
      conversationId: params.conversationId,
      durationMs: routerAttempt.durationMs,
    },
  );

  const directAttempt = await streamAgentResponse({
    agent: params.directMessagingAgentFactory(),
    attemptName: "direct-messaging",
    input: params.input,
    userId: params.userId,
    conversationId: params.conversationId,
    placeholderMessage: params.placeholderMessage,
  });

  return {
    text: directAttempt.text,
    durationMs: Date.now() - startMs,
    attempts: [routerAttempt, directAttempt],
  };
}
