import path from "node:path";
import { z } from "zod";

/**
 * Argo constructs a client even for local policy evaluation. This deliberately
 * unreachable kubeconfig keeps a test from inheriting any operator context or
 * credentials. Returns the file's path inside `directory`.
 */
export async function writeOfflineKubeconfig(
  directory: string,
): Promise<string> {
  const kubeconfig = path.join(directory, "kubeconfig");
  await Bun.write(
    kubeconfig,
    JSON.stringify({
      apiVersion: "v1",
      kind: "Config",
      clusters: [
        { name: "offline", cluster: { server: "http://127.0.0.1:1" } },
      ],
      users: [{ name: "offline", user: {} }],
      contexts: [
        { name: "offline", context: { cluster: "offline", user: "offline" } },
      ],
      "current-context": "offline",
    }),
  );
  return kubeconfig;
}

const BLOCKED_SHIM_SUFFIXES = [
  path.join(".local", "share", "toolkit", "shims"),
  path.join(".local", "share", "mise", "shims"),
];

function isBlockedSearchDirectory(entry: string, home?: string): boolean {
  if (entry.length === 0 || !path.isAbsolute(entry)) {
    return true;
  }
  const normalized = path.resolve(entry);
  if (normalized.split(path.sep).includes("node_modules")) {
    return true;
  }
  const matchesExplicitHome =
    home !== undefined &&
    home.length > 0 &&
    path.isAbsolute(home) &&
    BLOCKED_SHIM_SUFFIXES.some(
      (suffix) => normalized === path.resolve(home, suffix),
    );
  return (
    matchesExplicitHome ||
    BLOCKED_SHIM_SUFFIXES.some(
      (suffix) =>
        normalized === `${path.sep}${suffix}` ||
        normalized.endsWith(`${path.sep}${suffix}`),
    )
  );
}

/**
 * Scrubs toolkit/mise shims, relative entries, and `node_modules` from `PATH`
 * so fallback lookup reaches only direct system/toolchain directories.
 */
export function buildDirectSearchPath(rawPath: string, home?: string): string {
  return rawPath
    .split(path.delimiter)
    .filter((entry) => !isBlockedSearchDirectory(entry, home))
    .join(path.delimiter);
}

export type ResolveNativeArgoCdOptions = {
  cwd?: string;
  env?: Record<string, string | undefined>;
  spawnMiseWhich?: (options: {
    cwd: string;
    env: Record<string, string | undefined>;
  }) => { exitCode: number; stdout: string };
  which?: (
    command: string,
    options: { cwd: string; PATH: string },
  ) => string | null;
};

let cachedNativeArgoCd: string | undefined;

export function resetNativeArgoCdCache(): void {
  cachedNativeArgoCd = undefined;
}

function defaultSpawnMiseWhich(options: {
  cwd: string;
  env: Record<string, string | undefined>;
}): { exitCode: number; stdout: string } {
  try {
    const child = Bun.spawnSync(["mise", "which", "argocd"], {
      cwd: options.cwd,
      env: options.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 4000,
    });
    return {
      exitCode: child.exitCode,
      stdout: new TextDecoder().decode(child.stdout),
    };
  } catch {
    return { exitCode: 1, stdout: "" };
  }
}

/**
 * Resolves the real native `argocd` binary once under unscrubbed `Bun.env`
 * (real `HOME`) so isolated-`HOME` RBAC tests never invoke toolkit's
 * Keychain-authenticated wrapper or trigger interactive `mise trust` hangs.
 */
export function resolveNativeArgoCd(
  options?: ResolveNativeArgoCdOptions,
): string {
  if (options === undefined && cachedNativeArgoCd !== undefined) {
    return cachedNativeArgoCd;
  }

  const env = options?.env ?? Bun.env;
  const cwd = options?.cwd ?? import.meta.dir;
  const home = env["HOME"];
  const directSearchPath = buildDirectSearchPath(env["PATH"] ?? "", home);
  const spawnMiseWhich = options?.spawnMiseWhich ?? defaultSpawnMiseWhich;
  const which =
    options?.which ??
    ((command: string, whichOptions: { cwd: string; PATH: string }) =>
      Bun.which(command, whichOptions));

  const miseResult = spawnMiseWhich({ cwd, env });
  const miseCandidate = miseResult.stdout.trim();
  if (
    miseResult.exitCode === 0 &&
    miseCandidate.length > 0 &&
    path.isAbsolute(miseCandidate) &&
    !isBlockedSearchDirectory(path.dirname(miseCandidate), home)
  ) {
    if (options === undefined) {
      cachedNativeArgoCd = miseCandidate;
    }
    return miseCandidate;
  }

  const directCandidate = which("argocd", {
    cwd: "/",
    PATH: directSearchPath,
  });
  if (directCandidate !== null && directCandidate.length > 0) {
    if (options === undefined) {
      cachedNativeArgoCd = directCandidate;
    }
    return directCandidate;
  }

  throw new Error(
    "Unable to resolve native argocd binary via `mise which argocd` or scrubbed PATH",
  );
}

export type ArgoRbacQuery = {
  subject: string;
  action: string;
  resource: string;
  /** `<project>/<application>` */
  object: string;
  policyFile: string;
  kubeconfig: string;
  /** HOME for the CLI: the test's own scratch directory. */
  home: string;
  /** Whether ArgoCD's built-in roles (`role:readonly`, `role:admin`) apply. */
  builtinPolicy: boolean;
  /** Optional native `argocd` binary override for unit tests. */
  executable?: string;
};

/** Ask the native `argocd admin settings rbac can` evaluator for one decision. */
export async function argoRbacAllows(query: ArgoRbacQuery): Promise<boolean> {
  const executable = query.executable ?? resolveNativeArgoCd();
  const child = Bun.spawn(
    [
      executable,
      "admin",
      "settings",
      "rbac",
      "can",
      query.subject,
      query.action,
      query.resource,
      query.object,
      "--policy-file",
      query.policyFile,
      `--use-builtin-policy=${String(query.builtinPolicy)}`,
      "--kubeconfig",
      query.kubeconfig,
    ],
    {
      env: { PATH: path.dirname(executable), HOME: query.home },
      timeout: 4000,
      killSignal: "SIGKILL",
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0 && code !== 1)
    throw new Error(`Native Argo policy evaluation failed: ${stderr}`);
  const result = z.enum(["Yes", "No"]).safeParse(stdout.trim());
  if (!result.success)
    throw new Error(
      `Native Argo policy evaluator returned no decision: ${stderr}`,
    );
  return result.data === "Yes";
}
