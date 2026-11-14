import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const KIMI_SESSION_ID = "session_00000000-0000-4000-8000-00000000a001";
export const KIMI_WORKDIR = "wd_project_0123456789ab";
export const KIMI_CREATED_MS = 1_794_000_000_000;
export const KIMI_UPDATED_MS = 1_794_000_600_000;

const T0 = KIMI_CREATED_MS + 1000;

function jsonl(records: readonly Record<string, unknown>[]): string {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

/** Per-step usage, as Kimi repeats it on step.end and message meta. */
const STEP_USAGE = {
  inputOther: 1000,
  output: 200,
  inputCacheRead: 5000,
  inputCacheCreation: 300,
};

export function kimiMainWire(): Record<string, unknown>[] {
  return [
    { type: "metadata", protocol_version: "1.5", created_at: T0 },
    {
      type: "turn.prompt",
      agentId: "main",
      input: [{ type: "text", text: "Fix the flaky kimi-prompt-marker test" }],
      origin: { kind: "user" },
      promptId: "prompt-1",
      turnId: 1,
      time: T0 + 1,
    },
    {
      type: "llm.request",
      agentId: "main",
      provider: "openai",
      model: "k3.1-pro",
      modelAlias: "kimi-code/k3.1-pro",
      time: T0 + 2,
    },
    {
      type: "context.append_loop_event",
      agentId: "main",
      event: {
        type: "content.part",
        part: { type: "think", think: "kimi-think-marker" },
      },
      time: T0 + 3,
    },
    {
      type: "agent.message.appended",
      kind: "event",
      message: {
        message: {
          role: "assistant",
          content: [
            { type: "think", think: "kimi-think-marker" },
            { type: "text", text: "Looking at kimi-reply-marker now" },
          ],
          toolCalls: [{ id: "call-1", name: "Bash", arguments: "{}" }],
        },
        meta: {
          source: "llm",
          model: { provider: "agent-loop", model: "agent-loop" },
          usage: STEP_USAGE,
        },
      },
      time: T0 + 4,
    },
    {
      type: "context.append_loop_event",
      agentId: "main",
      event: {
        type: "tool.call",
        toolCallId: "call-1",
        name: "Bash",
        args: { command: "bun test kimi-arg-marker" },
      },
      time: T0 + 5,
    },
    {
      type: "context.append_loop_event",
      agentId: "main",
      event: {
        type: "tool.result",
        toolCallId: "call-1",
        result: { output: "kimi-output-marker passed", durationMs: 12 },
      },
      time: T0 + 6,
    },
    {
      type: "context.append_loop_event",
      agentId: "main",
      event: { type: "step.end", finishReason: "tool_use", usage: STEP_USAGE },
      time: T0 + 7,
    },
    {
      type: "usage.record",
      agentId: "main",
      model: "kimi-code/k3.1-pro",
      usage: STEP_USAGE,
      usageScope: "turn",
      time: T0 + 8,
    },
    // Cumulative session totals are not per-call usage.
    {
      type: "usage.record",
      agentId: "main",
      model: "kimi-code/k3.1-pro",
      usage: { inputOther: 9e6, output: 9e6, inputCacheRead: 0 },
      usageScope: "session",
      time: T0 + 9,
    },
    {
      type: "turn.steer",
      agentId: "main",
      input: [{ type: "text", text: "kimi-skill-marker instructions" }],
      origin: { kind: "skill_activation" },
      time: T0 + 10,
    },
    {
      type: "turn.steer",
      agentId: "main",
      input: [{ type: "text", text: "also check kimi-steer-marker" }],
      origin: { kind: "user" },
      time: T0 + 11,
    },
    {
      type: "context.append_loop_event",
      agentId: "main",
      event: {
        type: "tool.call",
        toolCallId: "call-2",
        name: "ReadMediaFile",
        args: { path: "/Users/example/project/shot.png" },
      },
      time: T0 + 12,
    },
    {
      type: "context.append_loop_event",
      agentId: "main",
      event: {
        type: "tool.result",
        toolCallId: "call-2",
        result: {
          output: [
            { type: "text", text: "kimi-array-output" },
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,AA" },
            },
          ],
          durationMs: 3,
        },
      },
      time: T0 + 13,
    },
    {
      type: "usage.record",
      agentId: "main",
      model: "kimi-code/k3.1-pro",
      usage: {
        inputOther: 50,
        output: 10,
        inputCacheRead: 6000,
        inputCacheCreation: 0,
      },
      usageScope: "turn",
      time: T0 + 14,
    },
  ];
}

function kimiSubagentWire(): Record<string, unknown>[] {
  return [
    {
      type: "turn.prompt",
      agentId: "sub-1",
      input: [{ type: "text", text: "Explore kimi-subagent-marker" }],
      origin: { kind: "user" },
      time: T0 + 20,
    },
    {
      type: "usage.record",
      agentId: "sub-1",
      model: "kimi-code/k3.1-pro",
      usage: { inputOther: 7, output: 3, inputCacheRead: 0 },
      usageScope: "turn",
      time: T0 + 21,
    },
  ];
}

export type KimiFixture = {
  readonly sessionsDir: string;
  readonly sessionDir: string;
};

export async function writeKimiFixture(
  sessionsDir: string,
  main: readonly Record<string, unknown>[] = kimiMainWire(),
): Promise<KimiFixture> {
  const sessionDir = path.join(sessionsDir, KIMI_WORKDIR, KIMI_SESSION_ID);
  const agents = path.join(sessionDir, "agents");
  await mkdir(path.join(agents, "main"), { recursive: true });
  await mkdir(path.join(agents, "sub-1"), { recursive: true });
  await writeFile(
    path.join(sessionDir, "state.json"),
    JSON.stringify({
      id: KIMI_SESSION_ID,
      version: 2,
      cwd: "/Users/example/project",
      archived: false,
      agents: {
        main: { homedir: path.join(agents, "main"), type: "main" },
        "sub-1": { homedir: path.join(agents, "sub-1"), type: "coder" },
      },
      custom: {},
      title: "Kimi fixture title",
      titleKind: "generated",
      lastPrompt: "also check",
      createdAt: KIMI_CREATED_MS,
      updatedAt: KIMI_UPDATED_MS,
      isCustomTitle: false,
    }),
  );
  await writeFile(path.join(agents, "main", "wire.jsonl"), jsonl(main));
  await writeFile(
    path.join(agents, "sub-1", "wire.jsonl"),
    jsonl(kimiSubagentWire()),
  );
  // Not an agent log: nested files under an agent are ignored.
  await mkdir(path.join(agents, "main", "tasks"), { recursive: true });
  await writeFile(path.join(agents, "main", "tasks", "wire.jsonl"), "");
  return { sessionsDir, sessionDir };
}
