/**
 * ArgoCD layer for `toolkit deployed`.
 *
 * Gotcha: `argocd app get` requires `--grpc-web` against this server, and the
 * synced "revision" it reports is the Helm chart version "2.0.0-<build>", NOT a
 * git SHA — so we parse the build number and compare numerically rather than
 * via `git merge-base`.
 *
 * Degrades cleanly: returns null (with a reason) when the CLI is missing or the
 * call fails, so the command still prints the git/gh verdict.
 */
import { resolveCredentials } from "#lib/credentials.ts";
import {
  buildPassthroughInvocation,
  lookupExecutable,
} from "#lib/passthrough.ts";
import { ArgoAppSchema } from "./schemas.ts";
import type { ArgoStatus } from "./types.ts";

const REVISION_BUILD_RE = /2\.0\.0-(\d+)/;

export type ArgoResult =
  { ok: true; status: ArgoStatus } | { ok: false; reason: string };

/**
 * `argocd app get` through the same broker and defaults as `toolkit argocd`:
 * the registered token, the homelab server, and `--grpc-web`.
 */
async function runArgoAppGet(
  app: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    await resolveCredentials(["ARGOCD_AUTH_TOKEN"]);
  } catch (error) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    };
  }
  const invocation = buildPassthroughInvocation(
    "argocd",
    ["app", "get", app, "-o", "json"],
    Bun.env,
  );
  const executable =
    invocation === null
      ? null
      : lookupExecutable(invocation.executable, invocation.env["PATH"]);
  if (invocation === null || executable === null) {
    return { exitCode: 127, stdout: "", stderr: "argocd CLI not found" };
  }
  const child = Bun.spawn([executable, ...invocation.args], {
    env: invocation.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stdout, stderr };
}

export async function getArgoApp(app: string): Promise<ArgoResult> {
  const result = await runArgoAppGet(app);

  if (result.exitCode !== 0) {
    const stderr = result.stderr.trim();
    return {
      ok: false,
      reason:
        stderr.length > 0
          ? (stderr.split("\n").at(-1) ?? "argocd error")
          : `argocd exited with code ${String(result.exitCode)}`,
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    return { ok: false, reason: "argocd returned non-JSON output" };
  }

  const parsed = ArgoAppSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, reason: "argocd output failed schema validation" };
  }

  const status = parsed.data.status;
  const deliveryEnvironmentId =
    parsed.data.metadata?.annotations?.[
      "delivery.shepherdjerred.com/environment"
    ];
  const revision = status?.sync?.revision ?? "";
  const buildMatch = REVISION_BUILD_RE.exec(revision);
  return {
    ok: true,
    status: {
      ...(deliveryEnvironmentId === undefined ? {} : { deliveryEnvironmentId }),
      app,
      syncStatus: status?.sync?.status ?? "Unknown",
      healthStatus: status?.health?.status ?? "Unknown",
      revision,
      revisionBuild:
        buildMatch?.[1] == null ? null : Number.parseInt(buildMatch[1], 10),
    },
  };
}
