import { resolveLaunch, type Which } from "#lib/brim/launch.ts";
import { TakeoverError } from "./errors.ts";
import { singleLineTitle, type PreparedTakeover } from "./handoff.ts";
import {
  closeOldTarget,
  execHerdrDo,
  maybeSendKimiPrompt,
  parseHerdrAppLs,
  resolveReplaceRuntime,
} from "./herdr-exec.ts";
import type { BrimProviderId } from "./providers.ts";
import type { HcCommandResult, HcCommandRunner } from "./terminal.ts";

const MAX_CLAUDE_SESSION_TITLE = 60;
const GRAPHEME_SEGMENTER = new Intl.Segmenter("en", {
  granularity: "grapheme",
});

export type PromptDelivery = "arg" | "clipboard";

export type ResolvedTakeoverLaunch = {
  readonly provider: BrimProviderId;
  readonly command: string;
  readonly path: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly prompt: string;
  readonly promptDelivery: PromptDelivery;
};

export type TakeoverSpawner = (
  argv: readonly string[],
  cwd: string,
) => Promise<number>;

export type SpawnTakeoverOptions = {
  readonly handoffPath: string;
  readonly platform?: NodeJS.Platform;
  readonly copyToClipboard?: (text: string) => Promise<boolean>;
  readonly stderr?: (line: string) => void;
  readonly spawn?: TakeoverSpawner;
};

export type HerdrAppRunner = (
  args: readonly string[],
) => Promise<HcCommandResult>;

export type HerdrDetachedRunner = (args: readonly string[]) => Promise<void>;

export type HerdrTerminalLocation = {
  readonly terminal: string;
  readonly space: string;
  readonly tab: string;
  readonly pane: string;
  readonly tabIndex: number;
  readonly tabName: string;
  readonly tabNamed: boolean;
  readonly paneCount: number;
};

export type HerdrReplacementResult = {
  readonly mode: "tab" | "pane";
  readonly space: string;
  readonly oldTab: string;
  readonly oldPane: string;
  readonly newTab: string | null;
  readonly newPane: string | null;
  readonly newTerminal: string | null;
  readonly closedOld: boolean;
  readonly detachedClose: boolean;
};

export type ReplaceHerdrOptions = {
  readonly terminalAddress: string;
  readonly launch: ResolvedTakeoverLaunch;
  readonly prepared: Pick<PreparedTakeover, "cwd" | "prompt">;
  readonly keepOpen?: boolean;
  readonly currentTerminalId?: string | null;
  readonly runHerdrApp?: HerdrAppRunner;
  readonly detachHerdrApp?: HerdrDetachedRunner;
  readonly runHc?: HcCommandRunner;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly readyTimeoutMs?: number;
  readonly pollIntervalMs?: number;
};

function hasNameFlag(extraArgs: readonly string[]): boolean {
  for (const token of extraArgs) {
    if (token === "--") {
      return false;
    }
    if (token === "--name" || token === "-n" || token.startsWith("--name=")) {
      return true;
    }
  }
  return false;
}

export function shortTitle(
  title: string,
  maxLength = MAX_CLAUDE_SESSION_TITLE,
): string {
  const clean = singleLineTitle(title);
  const graphemes = Array.from(
    GRAPHEME_SEGMENTER.segment(clean),
    (part) => part.segment,
  );
  return graphemes.length <= maxLength
    ? clean
    : graphemes.slice(0, maxLength).join("").trimEnd();
}

function buildProviderLaunchArgs(
  provider: BrimProviderId,
  title: string,
  prompt: string,
  extraArgs: readonly string[],
): {
  readonly args: readonly string[];
  readonly promptDelivery: PromptDelivery;
} {
  switch (provider) {
    case "claude-code":
      return {
        args: [
          ...extraArgs,
          ...(hasNameFlag(extraArgs) ? [] : ["--name", shortTitle(title)]),
          "--",
          prompt,
        ],
        promptDelivery: "arg",
      };
    case "codex":
    case "cursor":
    case "grok":
    case "muse":
      return { args: [...extraArgs, "--", prompt], promptDelivery: "arg" };
    case "antigravity":
      return { args: [...extraArgs, "-i", prompt], promptDelivery: "arg" };
    case "kimi":
      return { args: [...extraArgs], promptDelivery: "clipboard" };
  }
}

export function resolveTakeoverLaunch(
  provider: BrimProviderId,
  prepared: Pick<PreparedTakeover, "title" | "cwd" | "prompt">,
  extraArgs: readonly string[] = [],
  which?: Which,
): ResolvedTakeoverLaunch {
  const { args, promptDelivery } = buildProviderLaunchArgs(
    provider,
    prepared.title,
    prepared.prompt,
    extraArgs,
  );
  const resolved =
    which === undefined
      ? resolveLaunch(provider, args)
      : resolveLaunch(provider, args, which);
  return {
    provider,
    command: resolved.command,
    path: resolved.path,
    args: resolved.args,
    cwd: prepared.cwd,
    prompt: prepared.prompt,
    promptDelivery,
  };
}

async function defaultCopyToClipboard(text: string): Promise<boolean> {
  if (process.platform !== "darwin") {
    return false;
  }
  try {
    const child = Bun.spawn(["/usr/bin/pbcopy"], {
      stdin: new TextEncoder().encode(text),
      stdout: "ignore",
      stderr: "ignore",
    });
    return (await child.exited) === 0;
  } catch {
    return false;
  }
}

const defaultTakeoverSpawner: TakeoverSpawner = async (argv, cwd) => {
  const child = Bun.spawn([...argv], {
    cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return child.exited;
};

export async function spawnTakeoverLaunch(
  launch: ResolvedTakeoverLaunch,
  options: SpawnTakeoverOptions,
): Promise<number> {
  const stderr =
    options.stderr ??
    ((line: string) => {
      console.error(line);
    });
  const platform = options.platform ?? process.platform;
  if (launch.promptDelivery === "clipboard") {
    const copy =
      options.copyToClipboard ??
      (platform === "darwin"
        ? defaultCopyToClipboard
        : () => Promise.resolve(false));
    const copied = await copy(launch.prompt);
    stderr(
      copied
        ? `brim takeover: Kimi does not accept an initial prompt CLI flag; copied the takeover prompt to the clipboard. Paste it once Kimi starts (handoff: ${options.handoffPath}).`
        : `brim takeover: Kimi does not accept an initial prompt CLI flag; paste this prompt once Kimi starts:\n${launch.prompt}`,
    );
  }
  const spawn = options.spawn ?? defaultTakeoverSpawner;
  return spawn([launch.path, ...launch.args], launch.cwd);
}

export function locateHerdrTerminal(
  rawLsJson: string,
  terminalAddress: string,
): HerdrTerminalLocation {
  const data = parseHerdrAppLs(rawLsJson);
  for (const space of data.spaces) {
    for (const [index, tab] of space.tabs.entries()) {
      const tabIndex = index + 1;
      const match = tab.terminals.find(
        (entry) => entry.terminal === terminalAddress,
      );
      if (match !== undefined) {
        const tabNamed =
          tab.named ??
          (tab.name.trim().length > 0 && tab.name !== String(tabIndex));
        return {
          terminal: terminalAddress,
          space: space.id,
          tab: tab.id,
          pane: match.pane,
          tabIndex,
          tabName: tab.name,
          tabNamed,
          paneCount: tab.terminals.length,
        };
      }
    }
  }
  throw new TakeoverError(
    `Terminal "${terminalAddress}" was not found in any open Herdr space or tab.`,
  );
}

export async function replaceHerdrTerminal(
  options: ReplaceHerdrOptions,
): Promise<HerdrReplacementResult> {
  const runtime = resolveReplaceRuntime(options);
  const lsResult = await runtime.runHerdrApp(["ls"]);
  if (lsResult.exitCode !== 0) {
    const detail = lsResult.stderr.trim() || lsResult.stdout.trim();
    throw new TakeoverError(
      `herdr-app ls failed (${String(lsResult.exitCode)})${detail.length > 0 ? `: ${detail}` : ""}`,
    );
  }
  const location = locateHerdrTerminal(
    lsResult.stdout,
    options.terminalAddress,
  );
  const argv = [options.launch.path, ...options.launch.args];
  const isSelfTerminal = options.currentTerminalId === location.terminal;
  const keepOpen = options.keepOpen ?? false;
  const needsIdleDelivery = options.launch.promptDelivery === "clipboard";

  if (location.paneCount > 1) {
    const splitCreated = await execHerdrDo(runtime.runHerdrApp, "pane.split", {
      direction: "right",
      pane: location.pane,
      argv,
    });
    const newTerminal = splitCreated.terminal ?? null;
    await maybeSendKimiPrompt({
      needsIdleDelivery,
      sourceCommand: "pane.split",
      newTerminal,
      prompt: options.prepared.prompt,
      runtime,
    });
    const detachedClose = await closeOldTarget({
      command: "pane.close",
      payload: { pane: location.pane },
      keepOpen,
      isSelfTerminal,
      runHerdrApp: runtime.runHerdrApp,
      detachHerdrApp: runtime.detachHerdrApp,
    });
    return {
      mode: "pane",
      space: location.space,
      oldTab: location.tab,
      oldPane: location.pane,
      newTab: location.tab,
      newPane: splitCreated.pane ?? null,
      newTerminal,
      closedOld: !keepOpen,
      detachedClose,
    };
  }

  const tabCreated = await execHerdrDo(runtime.runHerdrApp, "tab.new", {
    space: location.space,
    folder: options.prepared.cwd,
    ...(location.tabNamed ? { name: location.tabName } : {}),
    argv,
  });
  const newTab = tabCreated.tab ?? null;
  const newTerminal = tabCreated.terminal ?? null;
  await execHerdrDo(runtime.runHerdrApp, "tab.move", {
    ...(newTab === null ? {} : { id: newTab }),
    index: location.tabIndex,
  });
  await maybeSendKimiPrompt({
    needsIdleDelivery,
    sourceCommand: "tab.new",
    newTerminal,
    prompt: options.prepared.prompt,
    runtime,
  });
  const detachedClose = await closeOldTarget({
    command: "tab.close",
    payload: { id: location.tab, confirmed: true },
    keepOpen,
    isSelfTerminal,
    runHerdrApp: runtime.runHerdrApp,
    detachHerdrApp: runtime.detachHerdrApp,
  });
  return {
    mode: "tab",
    space: location.space,
    oldTab: location.tab,
    oldPane: location.pane,
    newTab,
    newPane: tabCreated.pane ?? null,
    newTerminal,
    closedOld: !keepOpen,
    detachedClose,
  };
}
