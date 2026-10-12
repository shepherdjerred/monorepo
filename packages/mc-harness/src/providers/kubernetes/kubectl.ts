/**
 * Every cluster call the harness makes goes through `kubectl` with an explicit
 * context and namespace, impersonating the scoped mc-harness ServiceAccount
 * (packages/homelab mc-sandbox chart) so its RBAC, not the operator's admin
 * identity, bounds what a sandbox command can do.
 */
export const MC_SANDBOX_NAMESPACE = "mc-sandbox";
export const MC_HARNESS_SERVICE_ACCOUNT =
  "system:serviceaccount:mc-sandbox:mc-harness";
export const DEFAULT_KUBE_CONTEXT = "admin@torvalds";

export type KubeTarget = {
  readonly context: string;
  readonly namespace: string;
  /** Identity to impersonate (`--as`). */
  readonly as: string;
};

export type CommandResult = { stdout: string; stderr: string };

/** Runs `kubectl` with fully built argv; throws with stderr on non-zero exit. */
export type KubectlRunner = (
  args: readonly string[],
  options?: { stdin?: string },
) => Promise<CommandResult>;

/** The argv for one call: context, impersonation and namespace always come first. */
export function kubectlArgs(
  target: KubeTarget,
  args: readonly string[],
): string[] {
  return [
    "--context",
    target.context,
    `--as=${target.as}`,
    "-n",
    target.namespace,
    ...args,
  ];
}

export const spawnKubectl: KubectlRunner = async (args, options) => {
  const subprocess = Bun.spawn(["kubectl", ...args], {
    stdin: options?.stdin === undefined ? "ignore" : Buffer.from(options.stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `kubectl ${args.slice(5, 7).join(" ")} failed (${exitCode.toString()}): ${stderr.trim()}`,
    );
  }
  return { stdout, stderr };
};

/** kubectl bound to one target. */
export class Kubectl {
  constructor(
    readonly target: KubeTarget,
    private readonly runner: KubectlRunner = spawnKubectl,
  ) {}

  run(args: readonly string[], stdin?: string): Promise<CommandResult> {
    return this.runner(
      kubectlArgs(this.target, args),
      stdin === undefined ? undefined : { stdin },
    );
  }

  /** Argv for a long-running child (port-forward), with the same prefix. */
  argv(args: readonly string[]): string[] {
    return kubectlArgs(this.target, args);
  }
}
