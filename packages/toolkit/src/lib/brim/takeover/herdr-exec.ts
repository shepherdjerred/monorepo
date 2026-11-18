import os from "node:os";
import { z } from "zod";
import { TakeoverError } from "./errors.ts";
import {
  defaultHcRunner,
  parseHcTerminalJson,
  resolveLocalOrPathBinary,
  spawnCapturedCommand,
  type HcCommandResult,
  type HcCommandRunner,
} from "./terminal.ts";

const DEFAULT_KIMI_READY_TIMEOUT_MS = 30_000;
const DEFAULT_KIMI_POLL_INTERVAL_MS = 250;

export type HerdrExecRunner = (
  args: readonly string[],
) => Promise<HcCommandResult>;

export type HerdrDetachedExecRunner = (
  args: readonly string[],
) => Promise<void>;

export type ResolvedReplaceRuntime = {
  readonly runHerdrApp: HerdrExecRunner;
  readonly detachHerdrApp: HerdrDetachedExecRunner;
  readonly runHc: HcCommandRunner;
  readonly sleep: (ms: number) => Promise<void>;
  readonly timeoutMs: number;
  readonly pollIntervalMs: number;
};

const HerdrLsTerminalSchema = z.object({
  terminal: z.string(),
  pane: z.string(),
});

const HerdrLsTabSchema = z.object({
  id: z.string(),
  name: z.string(),
  named: z.boolean().optional(),
  terminals: z.array(HerdrLsTerminalSchema),
});

const HerdrLsSpaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  tabs: z.array(HerdrLsTabSchema),
});

const HerdrAppLsSchema = z.object({
  spaces: z.array(HerdrLsSpaceSchema),
});

const HerdrDoCreatedSchema = z.object({
  space: z.string().optional(),
  tab: z.string().optional(),
  pane: z.string().optional(),
  terminal: z.string().optional(),
  error: z.string().optional(),
});

export function parseHerdrAppLs(
  rawLsJson: string,
): z.infer<typeof HerdrAppLsSchema> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(rawLsJson);
  } catch (error: unknown) {
    throw new TakeoverError(
      `Failed to parse \`herdr-app ls\` JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const parsed = HerdrAppLsSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new TakeoverError(
      `Unexpected \`herdr-app ls\` JSON shape: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

export function resolveHerdrAppBinary(home: string = os.homedir()): string {
  return resolveLocalOrPathBinary("herdr-app", home);
}

export const defaultHerdrAppRunner: HerdrExecRunner = (args) =>
  spawnCapturedCommand(resolveHerdrAppBinary(), args);

export const defaultDetachedHerdrAppRunner: HerdrDetachedExecRunner = async (
  args,
) => {
  const binary = resolveHerdrAppBinary();
  const child = Bun.spawn(["/usr/bin/nohup", binary, ...args], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  child.unref();
  await Promise.resolve();
};

export async function execHerdrDo(
  runHerdrApp: HerdrExecRunner,
  command: string,
  payload: Record<string, unknown>,
): Promise<z.infer<typeof HerdrDoCreatedSchema>> {
  const result = await runHerdrApp(["do", command, JSON.stringify(payload)]);
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new TakeoverError(
      `herdr-app do ${command} failed (${String(result.exitCode)})${detail.length > 0 ? `: ${detail}` : ""}`,
    );
  }
  const trimmed = result.stdout.trim();
  if (trimmed.length === 0) {
    return {};
  }
  try {
    const parsed = HerdrDoCreatedSchema.safeParse(JSON.parse(trimmed));
    if (parsed.success) {
      if (parsed.data.error !== undefined) {
        throw new TakeoverError(
          `herdr-app do ${command} failed: ${parsed.data.error}`,
        );
      }
      return parsed.data;
    }
  } catch (error: unknown) {
    if (error instanceof TakeoverError) {
      throw error;
    }
  }
  return {};
}

async function deliverPromptWhenIdle(options: {
  readonly terminalId: string;
  readonly prompt: string;
  readonly runHc: HcCommandRunner;
  readonly sleep: (ms: number) => Promise<void>;
  readonly timeoutMs: number;
  readonly pollIntervalMs: number;
}): Promise<void> {
  const startedMs = Date.now();
  let elapsedMs = 0;
  for (;;) {
    const getRes = await options.runHc(["get", options.terminalId, "--json"]);
    if (getRes.exitCode === 0) {
      const state = parseHcTerminalJson(getRes.stdout).statusState;
      if (state === "idle") {
        break;
      }
      if (state === "error") {
        throw new TakeoverError(
          `New terminal ${options.terminalId} entered error state before prompt delivery.`,
        );
      }
    }
    if (
      elapsedMs >= options.timeoutMs ||
      Date.now() - startedMs >= options.timeoutMs
    ) {
      throw new TakeoverError(
        `Timed out waiting for terminal ${options.terminalId} to become idle before sending takeover prompt.`,
      );
    }
    await options.sleep(options.pollIntervalMs);
    elapsedMs += options.pollIntervalMs;
  }
  const sendRes = await options.runHc([
    "send",
    options.terminalId,
    options.prompt,
  ]);
  if (sendRes.exitCode !== 0) {
    const detail = sendRes.stderr.trim() || sendRes.stdout.trim();
    throw new TakeoverError(
      `hc send ${options.terminalId} failed (${String(sendRes.exitCode)})${detail.length > 0 ? `: ${detail}` : ""}`,
    );
  }
}

export async function closeOldTarget(options: {
  readonly command: "tab.close" | "pane.close";
  readonly payload: Record<string, unknown>;
  readonly keepOpen: boolean;
  readonly isSelfTerminal: boolean;
  readonly runHerdrApp: HerdrExecRunner;
  readonly detachHerdrApp: HerdrDetachedExecRunner;
}): Promise<boolean> {
  if (options.keepOpen) {
    return false;
  }
  if (options.isSelfTerminal) {
    await options.detachHerdrApp([
      "do",
      options.command,
      JSON.stringify(options.payload),
    ]);
    return true;
  }
  await execHerdrDo(options.runHerdrApp, options.command, options.payload);
  return false;
}

export async function maybeSendKimiPrompt(options: {
  readonly needsIdleDelivery: boolean;
  readonly sourceCommand: string;
  readonly newTerminal: string | null;
  readonly prompt: string;
  readonly runtime: ResolvedReplaceRuntime;
}): Promise<void> {
  if (!options.needsIdleDelivery) {
    return;
  }
  if (options.newTerminal === null) {
    throw new TakeoverError(
      `herdr-app do ${options.sourceCommand} did not return the new terminal ID needed for Kimi prompt delivery.`,
    );
  }
  await deliverPromptWhenIdle({
    terminalId: options.newTerminal,
    prompt: options.prompt,
    runHc: options.runtime.runHc,
    sleep: options.runtime.sleep,
    timeoutMs: options.runtime.timeoutMs,
    pollIntervalMs: options.runtime.pollIntervalMs,
  });
}

export function resolveReplaceRuntime(options: {
  readonly runHerdrApp?: HerdrExecRunner | undefined;
  readonly detachHerdrApp?: HerdrDetachedExecRunner | undefined;
  readonly runHc?: HcCommandRunner | undefined;
  readonly sleep?: ((ms: number) => Promise<void>) | undefined;
  readonly readyTimeoutMs?: number | undefined;
  readonly pollIntervalMs?: number | undefined;
}): ResolvedReplaceRuntime {
  return {
    runHerdrApp: options.runHerdrApp ?? defaultHerdrAppRunner,
    detachHerdrApp: options.detachHerdrApp ?? defaultDetachedHerdrAppRunner,
    runHc: options.runHc ?? defaultHcRunner,
    sleep:
      options.sleep ??
      ((ms: number) =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, ms);
        })),
    timeoutMs: options.readyTimeoutMs ?? DEFAULT_KIMI_READY_TIMEOUT_MS,
    pollIntervalMs: options.pollIntervalMs ?? DEFAULT_KIMI_POLL_INTERVAL_MS,
  };
}
