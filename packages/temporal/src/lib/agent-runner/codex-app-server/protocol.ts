import type { ThreadEvent } from "@openai/codex-sdk";
import { z } from "zod/v4";
import type { RunCodexAgentTurnInput } from "#lib/agent-runner/contract.ts";
import { ThreadResultSchema, type AppServerEventState } from "./events.ts";
import type { RpcMessage } from "./transport.ts";

const AuthSchema = z.object({
  auth_mode: z.literal("chatgpt").optional(),
  tokens: z.object({
    access_token: z.string().min(1),
    account_id: z.string().min(1),
    refresh_token: z.string().optional(),
    id_token: z.string().optional(),
  }),
});
export function codexSubscriptionTokens(authJson: string) {
  const parsed: unknown = JSON.parse(authJson);
  return AuthSchema.parse(parsed).tokens;
}

function threadParams(input: RunCodexAgentTurnInput) {
  return {
    model: input.model,
    cwd: input.cwd,
    approvalPolicy: "never",
    sandbox: input.sandboxPolicy.sandboxMode,
    config: {
      model_reasoning_effort: "high",
      web_search: input.sandboxPolicy.webSearchMode,
      "sandbox_workspace_write.network_access":
        input.sandboxPolicy.networkAccessEnabled,
      cli_auth_credentials_store: "ephemeral",
      skip_git_repo_check: input.skipGitRepoCheck ?? false,
    },
    ...(input.resumeSessionId === undefined
      ? {}
      : { threadId: input.resumeSessionId, excludeTurns: true }),
  };
}

function turnParams(input: RunCodexAgentTurnInput, threadId: string) {
  return {
    threadId,
    input: [{ type: "text", text: input.prompt, text_elements: [] }],
    cwd: input.cwd,
    model: input.model,
    approvalPolicy: "never",
    effort: "high",
    sandboxPolicy: turnSandboxPolicy(input),
    ...(input.outputSchema === undefined
      ? {}
      : { outputSchema: input.outputSchema }),
  };
}

function turnSandboxPolicy(input: RunCodexAgentTurnInput) {
  switch (input.sandboxPolicy.sandboxMode) {
    case "danger-full-access":
      return { type: "dangerFullAccess" };
    case "read-only":
      return {
        type: "readOnly",
        networkAccess: input.sandboxPolicy.networkAccessEnabled,
      };
    case "workspace-write":
      return {
        type: "workspaceWrite",
        writableRoots: [input.cwd],
        networkAccess: input.sandboxPolicy.networkAccessEnabled,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      };
  }
}

export async function* handshakeResponse(input: {
  expectedResponse: number;
  message: RpcMessage;
  run: RunCodexAgentTurnInput;
  state: AppServerEventState;
  auth: z.infer<typeof AuthSchema>["tokens"];
  send: (message: unknown) => Promise<void>;
  onExecutionState: (possiblyAppliedEffects: boolean) => void;
}): AsyncGenerator<ThreadEvent> {
  if (input.message.id !== input.expectedResponse)
    throw new Error("Unexpected Codex response ID");
  if (input.message.error !== undefined)
    throw new Error(input.message.error.message);
  switch (input.expectedResponse) {
    case 1:
      await input.send({ method: "initialized" });
      await input.send({
        id: 2,
        method: "account/login/start",
        params: {
          type: "chatgptAuthTokens",
          accessToken: input.auth.access_token,
          chatgptAccountId: input.auth.account_id,
        },
      });
      break;
    case 2:
      z.object({ type: z.literal("chatgptAuthTokens") }).parse(
        input.message.result,
      );
      await input.send({
        id: 3,
        method:
          input.run.resumeSessionId === undefined
            ? "thread/start"
            : "thread/resume",
        params: threadParams(input.run),
      });
      break;
    case 3: {
      input.state.threadId = ThreadResultSchema.parse(
        input.message.result,
      ).thread.id;
      if (
        input.run.resumeSessionId !== undefined &&
        input.state.threadId !== input.run.resumeSessionId
      ) {
        throw new Error("Codex resumed a different provider session");
      }
      yield { type: "thread.started", thread_id: input.state.threadId };
      input.run.signal.throwIfAborted();
      // A lost turn/start response is ambiguous; mark generation before submitting it.
      input.onExecutionState(false);
      await input.send({
        id: 4,
        method: "turn/start",
        params: turnParams(input.run, input.state.threadId),
      });
      yield { type: "turn.started" };
      break;
    }
    case 4:
      break;
    default:
      throw new Error("Unexpected extra Codex response");
  }
}

export async function rejectServerRequest(
  message: RpcMessage,
  send: (message: unknown) => Promise<void>,
): Promise<never> {
  const detail =
    message.method === "account/chatgptAuthTokens/refresh"
      ? "Codex authentication requires renewed subscription credentials; update the configured credential source"
      : `Unexpected Codex App Server request: ${String(message.method)}`;
  await send({ id: message.id, error: { code: -32_000, message: detail } });
  throw new Error(detail);
}
