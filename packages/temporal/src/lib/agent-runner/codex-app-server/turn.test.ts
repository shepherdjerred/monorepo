import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test, vi } from "vitest";
import { runSubscriptionCodexEvents } from "./turn.ts";
import type { RunCodexAgentTurnInput } from "#lib/agent-runner/contract.ts";

async function waitForFile(filePath: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await Bun.file(filePath).exists()) return;
    await Bun.sleep(10);
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

async function withProvider(
  scenario: string,
  verify: (input: {
    events: ReturnType<typeof runSubscriptionCodexEvents>;
    home: string;
    onExecutionState: ReturnType<typeof vi.fn>;
  }) => Promise<void>,
  resume = false,
  turnBudgetKind: "tool-steps" | "turns" = "tool-steps",
) {
  const home = await mkdtemp(path.join(os.tmpdir(), "codex-memory-auth-test-"));
  const authJson = JSON.stringify({
    tokens: {
      access_token: "test-access-token",
      account_id: "test-account",
      refresh_token: "test-refresh-token",
      id_token: "test-id-token",
    },
  });
  const run: RunCodexAgentTurnInput = {
    service: "temporal",
    callSite: "agent-chat",
    prompt: "test",
    model: "gpt-5.4",
    maxTurns: scenario === "budget" ? 1 : 4,
    cwd: home,
    env: {},
    auth: { kind: "chatgpt-subscription", authJson },
    signal: new AbortController().signal,
    turnBudgetKind,
    sandboxPolicy: {
      sandboxMode: "workspace-write",
      networkAccessEnabled: false,
      webSearchMode: "disabled",
    },
    beforeEvent: () => Promise.resolve(true),
    onEvent: vi.fn(),
    skipGitRepoCheck: true,
    ...(resume ? { resumeSessionId: "test-session" } : {}),
  };
  const onExecutionState = vi.fn();
  try {
    await verify({
      home,
      onExecutionState,
      events: runSubscriptionCodexEvents({
        excludedKeys: [],
        run,
        authJson,
        onExecutionState,
        command: [
          process.execPath,
          fileURLToPath(
            new URL("provider-process.fixture.ts", import.meta.url),
          ),
        ],
        environment: {
          PATH: Bun.env["PATH"] ?? "",
          CODEX_HOME: home,
          CODEX_APP_SERVER_FIXTURE_SCENARIO: scenario,
        },
      }),
    });
    expect(await Bun.file(path.join(home, "auth.json")).exists()).toBe(false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

describe("subscription App Server protocol", () => {
  test("submits the turn before a start-event observer can fail", async () => {
    await withProvider("success", async ({ events, home }) => {
      for await (const event of events) {
        if (event.type !== "turn.started") continue;
        // Flush proves pipe submission; allow the child to process it before inspection.
        await waitForFile(path.join(home, "turn-submitted"));
        break;
      }
    });
  });
  test.each(["tool-steps", "turns"] as const)(
    "honors the requested budget kind: %s",
    async (kind) => {
      await withProvider(
        "budget",
        async ({ events }) => {
          const consume = async () => {
            const observed = [];
            for await (const event of events) observed.push(event);
            return observed;
          };
          if (kind === "tool-steps")
            await expect(consume()).rejects.toThrow("exceeded maxTurns=1");
          else {
            const observed = await consume();
            expect(observed.at(-1)?.type).toBe("turn.completed");
          }
        },
        false,
        kind,
      );
    },
  );
  test.each([false, true])(
    "runs and resumes with memory-only credentials (resume=%s)",
    async (resume) => {
      await withProvider(
        "success",
        async ({ events, onExecutionState }) => {
          const observed = [];
          for await (const event of events) observed.push(event);
          expect(observed.map((event) => event.type)).toEqual([
            "thread.started",
            "turn.started",
            "item.started",
            "item.completed",
            "item.completed",
            "turn.completed",
          ]);
          expect(observed.at(-1)).toEqual({
            type: "turn.completed",
            usage: {
              input_tokens: 13,
              cached_input_tokens: 5,
              cache_write_input_tokens: 0,
              output_tokens: 8,
              reasoning_output_tokens: 2,
            },
          });
          expect(onExecutionState).toHaveBeenCalledWith(true);
        },
        resume,
      );
    },
  );

  test.each([
    ["renewal", "authentication requires renewed"],
    ["file-disconnect", "closed before completion"],
    ["unknown-tool", "Unsupported Codex App Server item type"],
  ])("fails safely after effectful activity: %s", async (scenario, message) => {
    await withProvider(scenario, async ({ events, onExecutionState }) => {
      await expect(
        (async () => {
          for await (const event of events) expect(event.type).toBeDefined();
        })(),
      ).rejects.toThrow(message);
      expect(onExecutionState).toHaveBeenCalledWith(true);
    });
  });

  test("does not silently resume the wrong session", async () => {
    await withProvider(
      "wrong-resume",
      async ({ events, onExecutionState }) => {
        await expect(
          (async () => {
            for await (const event of events) expect(event.type).toBeDefined();
          })(),
        ).rejects.toThrow("different provider session");
        expect(onExecutionState).not.toHaveBeenCalled();
      },
      true,
    );
  });

  test.each(["lost-start", "partial-json"])(
    "marks an ambiguous submission as generation started: %s",
    async (scenario) => {
      await withProvider(scenario, async ({ events, onExecutionState }) => {
        await expect(
          (async () => {
            for await (const event of events) expect(event.type).toBeDefined();
          })(),
        ).rejects.toThrow();
        expect(onExecutionState).toHaveBeenCalledWith(false);
        expect(onExecutionState).not.toHaveBeenCalledWith(true);
      });
    },
  );
});
