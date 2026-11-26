// The work behind the Herdr new-worktree dialog, run detached after the
// dialog closes: name the branch, space and tab from the first message, create
// the worktree on the space's machine, and open a space whose agent starts
// with that message. The dialog only gathers choices; this owns the slow parts.

export type Request = {
  /** The agent's first message; also what the branch and tab are named from. */
  readonly message: string;
  /** An explicitly selected branch skips generated naming and keeps its history if it exists. */
  readonly branch?: string;
  /** Brim provider id, or null for a plain shell. */
  readonly provider: string | null;
  /** hc machine name, or null for this computer. */
  readonly machine: string | null;
  /** The repository's main checkout and the checkout the dialog was opened in. */
  readonly repoMain: string;
  readonly repoTop: string;
  /** Folder the checkout goes in: <home>/.herdr/worktrees/<repo>. */
  readonly root: string;
  /** Agent flags from the dialog's mode, model and effort choices. */
  readonly agentArgs: readonly string[];
  /** Skip the agent-bin bypass flags (plan-style modes). */
  readonly safe: boolean;
  /**
   * How the space's machine starts an agent: "brim" runs `brim --provider`,
   * which uses the agent-bin wrappers (macOS and Linux); "profile" runs the
   * agent's PowerShell profile wrapper by name (Windows, which has no Brim).
   */
  readonly launcher: Launcher;
  /** A caller's own program instead of a provider, given the message as task. */
  readonly argv: readonly string[] | null;
  /** A caller's own first-tab name instead of the generated title. */
  readonly tab: string | null;
  /** Whether `message` is also sent to the started agent (`false` only names the branch and tab). */
  readonly sendMessage: boolean;
};

export type Launcher = "brim" | "profile";

/** Each provider's wrapper in the Windows PowerShell profile. */
const PROFILE_COMMAND: Readonly<Record<string, string>> = {
  "claude-code": "claude",
  codex: "codex",
  antigravity: "agy",
  cursor: "cursor-agent",
  grok: "grok",
  kimi: "kimi",
  muse: "muse",
};

export type Named = { readonly branch: string; readonly title: string | null };

export type ExecResult = {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
};

export type Runtime = {
  /** One OpenAI call: a valid branch name and a short title. */
  readonly name: (message: string) => Promise<Named>;
  /** Allocate the branch and checkout together on the target host. */
  readonly allocate: (
    request: Request,
    branch: string,
  ) => Promise<{ branch: string; path: string }>;
  /** `herdr-app do space.new <json>`; resolves to the new terminal's address. */
  readonly newSpace: (args: Record<string, unknown>) => Promise<string>;
  /** An `hc` call, for agents whose first message is typed in. */
  readonly hc: (args: string[]) => Promise<ExecResult>;
  readonly sleep: (ms: number) => Promise<void>;
} & Toolkit;

/** What starting `toolkit` in the background needs from this computer. */
export type Toolkit = {
  /** `process.platform` of this computer. */
  readonly platform: string;
  /**
   * Start `toolkit <args>` in `cwd` on this computer, detached and with its
   * output discarded, and return without waiting for it. False when this
   * computer has no toolkit.
   */
  readonly startToolkit: (cwd: string, args: string[]) => Promise<boolean>;
};

export type Step = "naming" | "branch" | "worktree" | "space" | "message";

/** One step of a run, for the sidebar. Title, branch and path fill in as known. */
export type Progress = {
  readonly step: Step;
  readonly title: string | null;
  readonly branch: string | null;
  readonly path: string | null;
};

/** What the sidebar reads while a run is in progress. No message text. */
export type ActiveRun = {
  readonly pid: number;
  readonly machine: string | null;
  readonly repo: string;
  readonly step: Step;
  readonly title: string | null;
  readonly branch: string | null;
  readonly path: string | null;
};

/** The repo folder `root` names, with either slash style and a trailing slash. */
export function repoName(root: string): string {
  const parts = root.split(/[/\\]/).filter((part) => part.length > 0);
  return parts.at(-1) ?? root;
}

export function activeRun(
  request: Request,
  progress: Progress,
  pid: number,
): ActiveRun {
  return {
    pid,
    machine: request.machine,
    repo: repoName(request.root),
    step: progress.step,
    title: progress.title,
    branch: progress.branch,
    path: progress.path,
  };
}

export type Outcome = {
  readonly branch: string;
  readonly title: string | null;
  readonly path: string;
  readonly terminal: string;
  readonly messageSent: "argument" | "typed" | "none";
  /** Whether sharing the checkout's files with the main checkout was started. */
  readonly dedupe: Dedupe;
};

export type Dedupe = "started" | "skipped";

export function fields(value: unknown, what: string): Map<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError(`${what} must be a JSON object.`);
  return new Map<string, unknown>(Object.entries(value));
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new TypeError(`Request ${field} must be a non-empty string.`);
  return value;
}

function nullableText(value: unknown, field: string): string | null {
  return value === null ? null : text(value, field);
}

function nullableStrings(value: unknown, field: string): string[] | null {
  return value === null || value === undefined ? null : strings(value, field);
}

function strings(value: unknown, field: string): string[] {
  if (!Array.isArray(value))
    throw new TypeError(`Request ${field} must be a string array.`);
  return value.map((item: unknown) => {
    if (typeof item !== "string")
      throw new TypeError(`Request ${field} must be a string array.`);
    return item;
  });
}

/** The dialog's request, checked: a malformed one is a broken contract. */
export function parseRequest(json: string): Request {
  const r = fields(JSON.parse(json), "Request");
  const safe = r.get("safe");
  if (typeof safe !== "boolean")
    throw new TypeError("Request safe must be a boolean.");
  const launcher = r.get("launcher");
  if (launcher !== "brim" && launcher !== "profile")
    throw new TypeError('Request launcher must be "brim" or "profile".');
  const rawSend = r.get("sendMessage");
  if (rawSend !== undefined && typeof rawSend !== "boolean")
    throw new TypeError("Request sendMessage must be a boolean.");
  const rawBranch = r.get("branch");
  const branch =
    rawBranch === undefined ? undefined : text(rawBranch, "branch");
  const message =
    branch === undefined ? text(r.get("message"), "message").trim() : "";
  return {
    message,
    ...(branch === undefined ? {} : { branch }),
    provider: nullableText(r.get("provider"), "provider"),
    machine: nullableText(r.get("machine"), "machine"),
    repoMain: text(r.get("repoMain"), "repoMain"),
    repoTop: text(r.get("repoTop"), "repoTop"),
    root: text(r.get("root"), "root"),
    agentArgs: strings(r.get("agentArgs"), "agentArgs"),
    safe,
    launcher,
    argv: nullableStrings(r.get("argv"), "argv"),
    tab: r.get("tab") === undefined ? null : nullableText(r.get("tab"), "tab"),
    sendMessage: branch === undefined && (rawSend ?? true),
  };
}

/** Checkouts go to <root>/<branch, slashes as dashes>. */
export function slug(branch: string): string {
  return branch.replaceAll(/[^\w.-]+/g, "-").replaceAll(/^-+|-+$/g, "");
}

/**
 * The command that starts a provider's wrapper with `args`. Herdr's argv
 * cannot set a variable on Windows, so a safe launch there goes through the
 * profile's `agent-safe`, its counterpart of `env AGENT_SAFE=1`.
 */
function agentCommand(
  request: Request,
  provider: string,
  args: string[],
): string[] {
  if (request.launcher === "brim")
    return [
      ...(request.safe ? ["env", "AGENT_SAFE=1"] : []),
      "brim",
      "--provider",
      provider,
      "--",
      ...args,
    ];
  const command = PROFILE_COMMAND[provider];
  if (command === undefined)
    throw new Error(`No PowerShell wrapper for provider ${provider}.`);
  return [...(request.safe ? ["agent-safe"] : []), command, ...args];
}

/**
 * How the first message reaches each agent. Herdr appends `task` to argv as
 * one argument, the initial prompt for most agents; a second `--` keeps a
 * message that starts with "-" from parsing as a flag. Antigravity takes it
 * only as -i, and Kimi has no initial-prompt argument, so it is typed in.
 */
export function launch(
  request: Request,
  named: Named,
): { argv: string[] | null; task: string | null; typed: boolean } {
  const { provider, message, sendMessage } = request;
  if (provider === null)
    return request.argv === null
      ? { argv: null, task: null, typed: false }
      : {
          argv: [...request.argv],
          task: sendMessage ? message : null,
          typed: false,
        };
  const extra = [...request.agentArgs];
  if (provider === "claude-code" && named.title !== null)
    extra.push("--name", named.title);
  if (!sendMessage)
    return {
      argv: agentCommand(request, provider, extra),
      task: null,
      typed: false,
    };
  if (provider === "antigravity") extra.push("-i", message);
  const typed = provider === "kimi";
  const asTask = provider !== "antigravity" && !typed;
  const argv = agentCommand(request, provider, [
    ...extra,
    ...(asTask ? ["--"] : []),
  ]);
  return { argv, task: asTask ? message : null, typed };
}

function firstLine(result: ExecResult, fallback: string): string {
  const output = result.stderr.trim() === "" ? result.stdout : result.stderr;
  const line = output.trim().split("\n")[0] ?? "";
  return line === "" ? fallback : line;
}

async function labelTask(
  runtime: Runtime,
  address: string,
  title: string,
): Promise<string | null> {
  const result = await runtime.hc(["label", address, `agent.task=${title}`]);
  return result.code === 0 ? null : firstLine(result, "hc label failed");
}

function agentState(result: ExecResult): string | null {
  if (result.code !== 0) return null;
  const status = fields(JSON.parse(result.stdout), "hc get").get("status");
  if (status === null || status === undefined) return null;
  const state = fields(status, "hc status").get("state");
  return typeof state === "string" ? state : null;
}

/** Wait until the agent is idle (a passing startup "blocked" is not ready), then type. */
async function typeFirstMessage(
  runtime: Runtime,
  terminal: string,
  message: string,
): Promise<void> {
  let state: string | null = null;
  for (let i = 0; i < 120; i++) {
    state = agentState(await runtime.hc(["get", terminal, "--json"]));
    if (state === "idle") break;
    await runtime.sleep(500);
  }
  if (state !== "idle")
    throw new Error(
      `The space is ready, but the agent never became idle (last: ${state ?? "unknown"}); its first message wasn't sent.`,
    );
  const sent = await runtime.hc(["send", terminal, message]);
  if (sent.code !== 0)
    throw new Error(
      `The space is ready, but its first message wasn't sent: ${firstLine(sent, "hc send failed")}`,
    );
}

/**
 * Start `toolkit` from `toolkitPath` in `cwd`, in its own session with no
 * stdio, so it outlives this process unobserved. False when it is not
 * installed. For a {@link Toolkit} on a real computer.
 */
export async function startDetachedToolkit(
  toolkitPath: string,
  cwd: string,
  args: string[],
): Promise<boolean> {
  if (!(await Bun.file(toolkitPath).exists())) return false;
  Bun.spawn([toolkitPath, ...args], {
    cwd,
    detached: true,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  }).unref();
  return true;
}

/**
 * A new worktree, or a pool slot, copies every tracked file. `toolkit tend
 * dedupe` replaces the ones identical to the main checkout's with APFS clones,
 * so this starts it in the background for a checkout on this Mac. It is an
 * optimization only: nothing waits on it, and a toolkit that is missing, does
 * not know the command, or fails leaves the worktree as git made it.
 */
export async function shareWithMainCheckout(
  runtime: Toolkit,
  machine: string | null,
  path: string,
): Promise<Dedupe> {
  if (machine !== null || runtime.platform !== "darwin") return "skipped";
  try {
    const started = await runtime.startToolkit(path, [
      "tend",
      "dedupe",
      "--worktree",
      path,
      "--apply",
      "--no-refresh",
      // Queue behind the daily sweep or another new worktree's run.
      "--lock-wait",
      "15m",
    ]);
    return started ? "started" : "skipped";
  } catch {
    return "skipped";
  }
}

/** Name it, create the worktree, open the space. Throws a message fit for a person. */
export async function createWorktree(
  request: Request,
  runtime: Runtime,
  progress: (update: Progress) => void | Promise<void>,
): Promise<Outcome> {
  const { machine } = request;
  const report = (
    step: Step,
    title: string | null,
    branch: string | null,
    path: string | null,
  ) => progress({ step, title, branch, path });
  if (request.branch === undefined) await report("naming", null, null, null);
  const named =
    request.branch === undefined
      ? await runtime.name(request.message)
      : { branch: request.branch, title: null };
  await report("worktree", named.title, named.branch, null);
  const { branch, path } = await runtime.allocate(request, named.branch);
  // The final path: a claimed pool slot was moved, and sharing is recorded by
  // path, so the slot's own pass does not cover the checkout it became.
  const dedupe = await shareWithMainCheckout(runtime, machine, path);
  await report("space", named.title, branch, path);
  const { argv, task, typed } = launch(request, { branch, title: named.title });
  const tab = request.tab ?? named.title;
  // Nesting follows the checkout folder. The generated title names the space
  // and, unless the caller named it, the first tab.
  const terminal = await runtime.newSpace({
    folder: path,
    machine: machine ?? "",
    focus: false,
    ...(named.title === null ? {} : { name: named.title }),
    ...(tab === null ? {} : { tab }),
    ...(argv === null ? {} : { argv }),
    ...(task === null ? {} : { task }),
  });
  const address =
    machine === null || terminal.includes("/")
      ? terminal
      : `${machine}/${terminal}`;
  const labelError =
    argv === null || named.title === null
      ? null
      : await labelTask(runtime, address, named.title);
  if (typed) {
    await report("message", named.title, branch, path);
    await typeFirstMessage(runtime, address, request.message);
  }
  if (labelError !== null)
    throw new Error(
      `The space is ready, but its task label was not set: ${labelError}`,
    );
  return {
    branch,
    title: named.title,
    path,
    terminal,
    messageSent:
      argv === null || !request.sendMessage
        ? "none"
        : typed
          ? "typed"
          : "argument",
    dedupe,
  };
}
