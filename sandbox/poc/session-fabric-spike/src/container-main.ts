// Runs INSIDE the spike container: optionally hydrate a session slice from S3,
// run one agent turn (codex or claude), push the updated slice, write result JSON.
import { pullLatest, pushSlice } from "./bundle.ts";
import { mkdir } from "node:fs/promises";
import { z } from "zod/v4";

const InputSchema = z.strictObject({
  provider: z.enum(["codex", "claude"]),
  sessionId: z.string().min(1),
  turn: z.number().int().nonnegative(),
  resume: z.boolean(),
  prompt: z.string().min(1),
});

const input = InputSchema.parse({
  provider: Bun.env["SPIKE_PROVIDER"],
  sessionId: Bun.env["SPIKE_SESSION_ID"],
  turn: Number(Bun.env["SPIKE_TURN"]),
  resume: Bun.env["SPIKE_RESUME"] === "1",
  prompt: Bun.env["SPIKE_PROMPT"],
});

const sessionHome = "/session-home";
const workspace = "/work/session";
await mkdir(workspace, { recursive: true });
await mkdir(`${sessionHome}/home`, { recursive: true });
await mkdir(`${sessionHome}/codex-home`, { recursive: true });

// Codex ChatGPT-subscription auth: materialize auth.json into CODEX_HOME from a
// base64 env blob. This is the auth path that actually works — passing
// CODEX_ACCESS_TOKEN instead flips the SDK to API-key mode and 401s. auth.json
// is credential-grade and is excluded from pushed slices (EXCLUDED_BASENAMES).
const codexAuthB64 = Bun.env["CODEX_AUTH_JSON_B64"];
if (codexAuthB64 !== undefined && codexAuthB64 !== "") {
  await Bun.write(
    `${sessionHome}/codex-home/auth.json`,
    Buffer.from(codexAuthB64, "base64"),
  );
}

let resumeProviderSessionId: string | undefined;
if (input.resume) {
  const manifest = await pullLatest(input.sessionId, sessionHome);
  if (manifest.provider !== input.provider) {
    throw new Error(
      `provider mismatch: bundle=${manifest.provider} here=${input.provider}`,
    );
  }
  if (manifest.workspacePath !== workspace) {
    throw new Error(
      `workspacePath mismatch: bundle=${manifest.workspacePath} here=${workspace}`,
    );
  }
  resumeProviderSessionId = manifest.providerSessionId;
}

async function runCodexTurn(): Promise<{
  providerSessionId: string;
  finalText: string;
}> {
  const { Codex } = await import("@openai/codex-sdk");
  const codex = new Codex();
  const options = { workingDirectory: workspace, skipGitRepoCheck: true };
  const thread =
    resumeProviderSessionId === undefined
      ? codex.startThread(options)
      : codex.resumeThread(resumeProviderSessionId, options);
  const result = await thread.run(input.prompt);
  const threadId = thread.id;
  if (threadId === null || threadId === undefined)
    throw new Error("codex thread id missing after run");
  return { providerSessionId: threadId, finalText: result.finalResponse ?? "" };
}

async function runClaudeTurn(): Promise<{
  providerSessionId: string;
  finalText: string;
}> {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  let sessionId: string | undefined;
  let finalText = "";
  const stream = query({
    prompt: input.prompt,
    options: {
      cwd: workspace,
      maxTurns: 4,
      permissionMode: "bypassPermissions",
      ...(resumeProviderSessionId === undefined
        ? {}
        : { resume: resumeProviderSessionId }),
    },
  });
  for await (const message of stream) {
    if (message.type === "system" && message.subtype === "init")
      sessionId = message.session_id;
    if (message.type === "result") {
      sessionId = message.session_id;
      if (message.subtype === "success") finalText = message.result;
      else throw new Error(`claude turn ended with ${message.subtype}`);
    }
  }
  if (sessionId === undefined) throw new Error("claude session id missing");
  return { providerSessionId: sessionId, finalText };
}

const turn =
  input.provider === "codex" ? await runCodexTurn() : await runClaudeTurn();

await pushSlice({
  provider: input.provider,
  sessionId: input.sessionId,
  turn: input.turn,
  providerSessionId: turn.providerSessionId,
  workspacePath: workspace,
  sessionHome,
});

await Bun.write(
  "/out/result.json",
  JSON.stringify({
    provider: input.provider,
    providerSessionId: turn.providerSessionId,
    finalText: turn.finalText,
  }),
);
console.error(`[turn] done: provider=${input.provider} turn=${input.turn}`);
