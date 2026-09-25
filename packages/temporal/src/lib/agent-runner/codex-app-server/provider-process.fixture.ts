import path from "node:path";
import { z } from "zod/v4";
import { readRpcMessages } from "./transport.ts";

const environment = z
  .object({
    CODEX_HOME: z.string(),
    CODEX_APP_SERVER_FIXTURE_SCENARIO: z.string(),
  })
  .parse(Bun.env);
const scenario = environment.CODEX_APP_SERVER_FIXTURE_SCENARIO;
const authPath = path.join(environment.CODEX_HOME, "auth.json");
const emit = (message: unknown): void => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};
const item = (method: string, value: unknown): void => {
  emit({ method, params: { threadId: "test-session", item: value } });
};

function emitTurn() {
  if (scenario === "lost-start") process.exit(1);
  if (scenario === "partial-json") {
    process.stdout.write('{"id":');
    process.exit(1);
  }
  emit({ id: 4, result: { turn: { id: "turn", status: "inProgress" } } });
  if (scenario === "unknown-tool") {
    item("item/started", { id: "tool", type: "imageGeneration" });
    return;
  }
  const file = {
    id: "file",
    type: "fileChange",
    changes: [],
    status: "inProgress",
  };
  if (scenario === "renewal" || scenario === "file-disconnect") {
    item("item/started", file);
    if (scenario === "file-disconnect") process.exit(1);
    emit({
      id: 999,
      method: "account/chatgptAuthTokens/refresh",
      params: {
        reason: "unauthorized",
        previousAccountId: "test-account",
      },
    });
    return;
  }
  const command = {
    id: "command",
    type: "commandExecution",
    command: "pwd",
    aggregatedOutput: null,
    exitCode: null,
    status: "inProgress",
  };
  item("item/started", command);
  if (scenario === "budget")
    item("item/started", { ...command, id: "second-command" });
  item("item/completed", {
    ...command,
    status: "completed",
    exitCode: 0,
    aggregatedOutput: "test-access-token",
  });
  item("item/completed", {
    id: "message",
    type: "agentMessage",
    phase: "final_answer",
    text: "complete test-access-token",
  });
  emit({
    method: "thread/tokenUsage/updated",
    params: {
      threadId: "test-session",
      tokenUsage: {
        total: {
          totalTokens: 21,
          inputTokens: 13,
          cachedInputTokens: 5,
          outputTokens: 8,
          reasoningOutputTokens: 2,
        },
        last: {
          totalTokens: 21,
          inputTokens: 13,
          cachedInputTokens: 5,
          outputTokens: 8,
          reasoningOutputTokens: 2,
        },
      },
    },
  });
  emit({
    method: "turn/completed",
    params: {
      threadId: "test-session",
      turn: { status: "completed", error: null },
    },
  });
}

for await (const message of readRpcMessages(Bun.stdin.stream())) {
  if (await Bun.file(authPath).exists())
    throw new Error("Provider credentials were written to disk");
  if (message.method === undefined) {
    if (
      scenario !== "renewal" ||
      message.id !== 999 ||
      message.error === undefined
    ) {
      throw new Error("Unexpected client response");
    }
    break;
  }
  switch (message.method) {
    case "initialize":
      if (!Bun.argv.includes('cli_auth_credentials_store="ephemeral"'))
        throw new Error("Missing ephemeral auth config");
      emit({ id: 1, result: {} });
      break;
    case "initialized":
      break;
    case "account/login/start": {
      if (scenario === "redaction") {
        emit({
          id: 2,
          error: { message: "caller-redaction-token" },
        });
        break;
      }
      const params = z
        .object({
          type: z.literal("chatgptAuthTokens"),
          accessToken: z.literal("test-access-token"),
          chatgptAccountId: z.literal("test-account"),
        })
        .parse(message.params);
      emit({ id: 2, result: { type: params.type } });
      break;
    }
    case "thread/start":
    case "thread/resume": {
      const params = z
        .object({
          cwd: z.string(),
          model: z.literal("gpt-5.4"),
          approvalPolicy: z.literal("never"),
          config: z.object({
            cli_auth_credentials_store: z.literal("ephemeral"),
            skip_git_repo_check: z.literal(true),
          }),
          threadId: z.literal("test-session").optional(),
        })
        .parse(message.params);
      if (message.method === "thread/resume" && params.threadId === undefined)
        throw new Error("Missing resume ID");
      emit({
        id: 3,
        result: {
          thread: {
            id:
              scenario === "wrong-resume"
                ? "different-session"
                : "test-session",
          },
        },
      });
      break;
    }
    case "turn/start":
      await Bun.write(
        path.join(environment.CODEX_HOME, "turn-submitted"),
        "submitted",
      );
      emitTurn();
      break;
    default:
      throw new Error("Unexpected client request");
  }
}
