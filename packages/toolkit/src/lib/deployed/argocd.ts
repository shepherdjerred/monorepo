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
import { $ } from "bun";
import { ArgoAppSchema } from "./schemas.ts";
import type { ArgoStatus } from "./types.ts";

const REVISION_BUILD_RE = /2\.0\.0-(\d+)/;

export type ArgoResult =
  | { ok: true; status: ArgoStatus }
  | { ok: false; reason: string };

export async function getArgoApp(app: string): Promise<ArgoResult> {
  const result = await $`argocd app get ${app} --grpc-web -o json`
    .nothrow()
    .quiet();

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
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
    json = JSON.parse(result.stdout.toString());
  } catch {
    return { ok: false, reason: "argocd returned non-JSON output" };
  }

  const parsed = ArgoAppSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, reason: "argocd output failed schema validation" };
  }

  const status = parsed.data.status;
  const revision = status?.sync?.revision ?? "";
  const buildMatch = REVISION_BUILD_RE.exec(revision);
  return {
    ok: true,
    status: {
      app,
      syncStatus: status?.sync?.status ?? "Unknown",
      healthStatus: status?.health?.status ?? "Unknown",
      revision,
      revisionBuild:
        buildMatch?.[1] == null ? null : Number.parseInt(buildMatch[1], 10),
    },
  };
}
