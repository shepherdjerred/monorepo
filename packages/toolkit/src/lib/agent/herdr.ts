import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { defaultCommandRunner } from "#lib/tend/process-probe.ts";

/** Injectable process runner so reach/send logic is testable without a live core. */
export type AgentCommandRunner = (
  args: readonly string[],
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

/** Default runner: resolves `hc` from ~/.local/bin when PATH misses it, then delegates to tend's shared runner. */
export const defaultAgentRunner: AgentCommandRunner = (args) => {
  const [bin, ...rest] = args;
  if (bin === undefined)
    return Promise.resolve({
      exitCode: 127,
      stdout: "",
      stderr: "empty command",
    });
  const executable =
    bin === "hc"
      ? (Bun.which("hc", { PATH: path.join(os.homedir(), ".local", "bin") }) ??
        Bun.which("hc") ??
        bin)
      : bin;
  return defaultCommandRunner([executable, ...rest], { timeoutMs: 30_000 });
};

const TerminalSchema = z.looseObject({
  address: z.string(),
  agent: z.string().optional(),
  cwd: z.string().optional(),
  state: z.string().optional(),
  status: z
    .union([
      z.string(),
      z.looseObject({
        app: z.string().optional(),
        state: z.string().optional(),
      }),
    ])
    .optional(),
  where: z.string().optional(),
});
const LsSchema = z.looseObject({
  machines: z
    .array(z.looseObject({ name: z.string(), state: z.string().optional() }))
    .optional(),
  terminals: z.array(TerminalSchema).optional(),
});
const GetSchema = z.looseObject({
  address: z.string(),
  cwd: z.string().nullish(),
  labels: z.record(z.string(), z.string()).nullish(),
  status: z
    .union([
      z.string(),
      z.looseObject({ app: z.string().nullish(), state: z.string().nullish() }),
    ])
    .nullish(),
  foreground: z
    .looseObject({ cwd: z.string().nullish(), name: z.string().nullish() })
    .nullish(),
});

export type HerdrTerminal = {
  address: string;
  bare: string;
  machine: string | null;
  app: string | null;
  state: string | null;
  cwd: string | null;
  where: string | null;
};
export type HerdrLocation = {
  spaceId: string;
  spaceName: string | null;
  tabId: string;
  tabName: string | null;
  pane: string | null;
};

function bareOf(address: string): string {
  return address.slice(address.lastIndexOf("/") + 1);
}
function machineOf(address: string): string | null {
  const i = address.indexOf("/");
  return i === -1 ? null : address.slice(0, i);
}
function statusOf(status: z.infer<typeof TerminalSchema>["status"]): {
  app: string | null;
  state: string | null;
} {
  return status === undefined
    ? { app: null, state: null }
    : typeof status === "string"
      ? { app: null, state: status }
      : { app: status.app ?? null, state: status.state ?? null };
}

export class HerdrClient {
  constructor(private readonly run: AgentCommandRunner = defaultAgentRunner) {}

  async list(): Promise<{ machines: string[]; terminals: HerdrTerminal[] }> {
    const result = await this.run(["hc", "ls", "--json"]);
    if (result.exitCode !== 0)
      throw new Error(
        `hc ls failed (${String(result.exitCode)}): ${result.stderr.trim() || result.stdout.trim()}`,
      );
    const parsed = LsSchema.parse(JSON.parse(result.stdout));
    return {
      machines: (parsed.machines ?? []).map((m) => m.name),
      terminals: (parsed.terminals ?? []).map((t) => {
        const { app, state } = statusOf(t.status);
        return {
          address: t.address,
          bare: bareOf(t.address),
          machine: machineOf(t.address),
          app: t.agent ?? app,
          state,
          cwd: t.cwd ?? null,
          where: t.where ?? null,
        };
      }),
    };
  }

  async get(address: string): Promise<{
    address: string;
    space: string | null;
    tab: string | null;
    app: string | null;
    state: string | null;
    cwd: string | null;
  } | null> {
    const result = await this.run(["hc", "get", address, "--json"]);
    if (result.exitCode !== 0) return null;
    try {
      const parsed = GetSchema.parse(JSON.parse(result.stdout));
      const rawStatus = parsed.status ?? undefined;
      const app =
        typeof rawStatus === "object" ? (rawStatus.app ?? null) : null;
      const state =
        typeof rawStatus === "string"
          ? rawStatus
          : typeof rawStatus === "object"
            ? (rawStatus.state ?? null)
            : null;
      return {
        address: parsed.address,
        space: parsed.labels?.["herdr.space"] ?? null,
        tab: parsed.labels?.["herdr.tab"] ?? null,
        app,
        state,
        cwd: parsed.foreground?.cwd ?? parsed.cwd ?? null,
      };
    } catch {
      return null;
    }
  }

  /** Best-effort space/tab names from the Herdr window; empty when no window answers. */
  async locations(): Promise<Map<string, HerdrLocation>> {
    const map = new Map<string, HerdrLocation>();
    const result = await this.run(["herdr-app", "ls"]);
    if (result.exitCode !== 0) return map;
    try {
      const data = z
        .looseObject({
          spaces: z.array(
            z.looseObject({
              id: z.string(),
              name: z.string().optional(),
              tabs: z.array(
                z.looseObject({
                  id: z.string(),
                  name: z.string().optional(),
                  terminals: z.array(
                    z.looseObject({
                      terminal: z.string(),
                      pane: z.string().optional(),
                    }),
                  ),
                }),
              ),
            }),
          ),
        })
        .parse(JSON.parse(result.stdout));
      for (const space of data.spaces)
        for (const tab of space.tabs)
          for (const term of tab.terminals)
            map.set(term.terminal, {
              spaceId: space.id,
              spaceName: space.name ?? null,
              tabId: tab.id,
              tabName: tab.name ?? null,
              pane: term.pane ?? null,
            });
    } catch {
      return map;
    }
    return map;
  }

  async send(
    address: string,
    text: string,
    force: boolean,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return this.run([
      "hc",
      "send",
      ...(force ? ["--force"] : []),
      "--json",
      address,
      text,
    ]);
  }
}
