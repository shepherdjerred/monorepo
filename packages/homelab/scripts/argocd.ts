#!/usr/bin/env bun
/**
 * ArgoCD operations: trigger a sync, wait for an app to become healthy, and
 * wait for a pruned resource (with a finalizer) to fully delete.
 *
 * Ported from the old CI's `argoCdSyncHelper` / `argoCdHealthWaitHelper` /
 * `waitForArgoCdResourceDeletionHelper` (.dagger/src/release.ts). Runs locally
 * as a plain Bun script using fetch instead of curl+jq; the polling logic and
 * timeouts are preserved.
 *
 * Usage:
 *   bun packages/homelab/scripts/argocd.ts sync <app> [--timeout <s>] [--dry-run]
 *   bun packages/homelab/scripts/argocd.ts health-wait <app> [--timeout <s>] [--dry-run]
 *   bun packages/homelab/scripts/argocd.ts wait-deletion <app> \
 *       --group <g> --version <v> --kind <k> --namespace <ns> \
 *       [--timeout <s>] [--dry-run]
 *
 * Env:
 *   ARGOCD_TOKEN     — ArgoCD API bearer token (required unless --dry-run)
 *   ARGOCD_SERVER_URL — optional, defaults to https://argocd.sjer.red
 */

import { requireEnv, optionalEnv } from "../../../scripts/lib/run.ts";

const DEFAULT_SERVER_URL = "https://argocd.sjer.red";
const DEFAULT_HEALTH_TIMEOUT_S = 300;
const DEFAULT_SYNC_TIMEOUT_S = 300;
const DEFAULT_DELETION_TIMEOUT_S = 120;
const POLL_INTERVAL_MS = 10_000;

function serverUrl(): string {
  return optionalEnv("ARGOCD_SERVER_URL") ?? DEFAULT_SERVER_URL;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * GET an ArgoCD application. Fails fast on any non-200 (auth/ingress errors are
 * not transient; looping wastes time), surfacing the status and a body snippet
 * — matching the old helper's `-sS -L` behavior with a redirect cap.
 */
async function getApplication(
  appName: string,
  token: string,
): Promise<Record<string, unknown>> {
  const url = `${serverUrl()}/api/v1/applications/${appName}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "follow",
  });
  if (res.status !== 200) {
    const body = (await res.text()).slice(0, 1024);
    throw new Error(
      `ERROR: ${url} returned HTTP ${res.status.toString()}\n` +
        `Response body (first 1KB): ${body}`,
    );
  }
  const data: unknown = await res.json();
  if (!isRecord(data)) {
    throw new Error(`${url} returned a non-object body`);
  }
  return data;
}

/**
 * Trigger an ArgoCD sync for an application and wait for the sync OPERATION to
 * reach a terminal phase, failing on anything but Succeeded.
 *
 * The POST only starts the operation; its result lands asynchronously in
 * `status.operationState`. Returning on POST success let a failed operation
 * (e.g. an unreachable kyverno admission webhook rejecting every apply) pass
 * this step and surface two steps later as a tofu tunnel-gate timeout with a
 * misleading symptom (build 5748). Failing here puts the error at the step
 * that caused it, where Buildkite's automatic retry re-syncs through
 * transient webhook downtime.
 */
async function sync(
  appName: string,
  timeoutSeconds: number,
  dryRun: boolean,
): Promise<void> {
  console.log(`--- argocd sync: ${appName}${dryRun ? " (dry run)" : ""}`);
  if (dryRun) {
    console.log(`DRYRUN: would POST sync for ArgoCD app ${appName}`);
    return;
  }
  const token = requireEnv("ARGOCD_TOKEN");
  const url = `${serverUrl()}/api/v1/applications/${appName}/sync`;
  // Operations started before this instant are a previous sync, not ours.
  const postedAt = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 1024);
    throw new Error(
      `Sync failed: HTTP ${res.status.toString()} ${res.statusText}\n${body}`,
    );
  }
  console.log(`sync operation started: ${appName}`);

  const deadline = Date.now() + timeoutSeconds * 1000;
  let elapsed = 0;
  while (Date.now() < deadline) {
    const app = await getApplication(appName, token);
    const status = isRecord(app["status"]) ? app["status"] : {};
    const op = isRecord(status["operationState"])
      ? status["operationState"]
      : {};
    const phase = typeof op["phase"] === "string" ? op["phase"] : "";
    const startedAt =
      typeof op["startedAt"] === "string" ? Date.parse(op["startedAt"]) : NaN;
    // Ignore a stale operationState from an earlier sync (30s clock-skew slack).
    const isOurs = !Number.isNaN(startedAt) && startedAt >= postedAt - 30_000;
    console.log(
      `Operation: ${phase || "(pending)"}${isOurs ? "" : " [previous op]"} ` +
        `(${elapsed.toString()}/${timeoutSeconds.toString()}s)`,
    );
    if (isOurs && phase === "Succeeded") {
      console.log(`synced: ${appName}`);
      return;
    }
    if (isOurs && (phase === "Failed" || phase === "Error")) {
      const message = typeof op["message"] === "string" ? op["message"] : "";
      throw new Error(
        `Sync operation ${phase} for ${appName}: ${message.slice(0, 1024)}`,
      );
    }
    await Bun.sleep(POLL_INTERVAL_MS);
    elapsed += POLL_INTERVAL_MS / 1000;
  }
  throw new Error(
    `Timeout: sync operation for ${appName} did not complete within ${timeoutSeconds.toString()}s`,
  );
}

/** Poll until an application is Healthy or the timeout elapses. */
async function healthWait(
  appName: string,
  timeoutSeconds: number,
  dryRun: boolean,
): Promise<void> {
  console.log(
    `--- argocd health-wait: ${appName}${dryRun ? " (dry run)" : ""}`,
  );
  if (dryRun) {
    console.log(`DRYRUN: would wait for ArgoCD app ${appName} to be Healthy`);
    return;
  }
  const token = requireEnv("ARGOCD_TOKEN");
  const deadline = Date.now() + timeoutSeconds * 1000;
  let elapsed = 0;
  while (Date.now() < deadline) {
    const app = await getApplication(appName, token);
    const status = isRecord(app["status"]) ? app["status"] : {};
    const health = isRecord(status["health"]) ? status["health"] : {};
    const value = typeof health["status"] === "string" ? health["status"] : "";
    console.log(
      `Health: ${value} (${elapsed.toString()}/${timeoutSeconds.toString()}s)`,
    );
    if (value === "Healthy") {
      console.log(`healthy: ${appName}`);
      return;
    }
    await Bun.sleep(POLL_INTERVAL_MS);
    elapsed += POLL_INTERVAL_MS / 1000;
  }
  throw new Error(
    `Timeout: ${appName} did not become Healthy within ${timeoutSeconds.toString()}s`,
  );
}

/**
 * Poll ArgoCD's resource tree until no resource matching group/version/kind/
 * namespace remains (i.e. the finalizer has run and the K8s object is gone).
 * Filters by GVK+namespace rather than an exact name because cdk8s ApiObjects
 * get hash-suffixed names once nested under a Chart, so a guessed name would
 * not match and this gate would 404 as "already deleted" prematurely.
 */
async function waitDeletion(opts: {
  appName: string;
  group: string;
  version: string;
  kind: string;
  namespace: string;
  timeoutSeconds: number;
  dryRun: boolean;
}): Promise<void> {
  const { appName, group, version, kind, namespace, timeoutSeconds, dryRun } =
    opts;
  const label = `${kind} (group=${group}, ns=${namespace})`;
  console.log(
    `--- argocd wait-deletion: ${label} in ${appName}` +
      (dryRun ? " (dry run)" : ""),
  );
  if (dryRun) {
    console.log(
      `DRYRUN: would wait for all ${label} to be deleted from app ${appName}`,
    );
    return;
  }
  const token = requireEnv("ARGOCD_TOKEN");
  const deadline = Date.now() + timeoutSeconds * 1000;
  let elapsed = 0;
  while (Date.now() < deadline) {
    const app = await getApplication(appName, token);
    const status = isRecord(app["status"]) ? app["status"] : {};
    const resources = Array.isArray(status["resources"])
      ? status["resources"]
      : [];
    const remaining = resources.filter((r: unknown) => {
      if (!isRecord(r)) {
        return false;
      }
      return (
        r["group"] === group &&
        r["version"] === version &&
        r["kind"] === kind &&
        r["namespace"] === namespace
      );
    }).length;
    console.log(
      `${label}: ${remaining.toString()} remaining ` +
        `(${elapsed.toString()}/${timeoutSeconds.toString()}s)`,
    );
    if (remaining === 0) {
      console.log(`${label} is fully deleted.`);
      return;
    }
    await Bun.sleep(POLL_INTERVAL_MS);
    elapsed += POLL_INTERVAL_MS / 1000;
  }
  throw new Error(
    `Timeout: ${label} was not fully deleted within ${timeoutSeconds.toString()}s`,
  );
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage(): never {
  console.error(
    "Usage:\n" +
      "  bun packages/homelab/scripts/argocd.ts sync <app> " +
      "[--timeout <s>] [--dry-run]\n" +
      "  bun packages/homelab/scripts/argocd.ts health-wait <app> " +
      "[--timeout <s>] [--dry-run]\n" +
      "  bun packages/homelab/scripts/argocd.ts wait-deletion <app> " +
      "--group <g> --version <v> --kind <k> --namespace <ns> " +
      "[--timeout <s>] [--dry-run]",
  );
  process.exit(1);
}

/** Read a named `--flag value` option from argv, or undefined if absent. */
function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) {
    return undefined;
  }
  const v = argv[i + 1];
  if (v === undefined || v.startsWith("--")) {
    console.error(`--${name} requires a value`);
    usage();
  }
  return v;
}

async function main(): Promise<void> {
  const argv = Bun.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h") || argv.length === 0) {
    usage();
  }
  const dryRun = argv.includes("--dry-run");
  const subcommand = argv[0];
  const app = argv[1];
  if (app === undefined || app.startsWith("--")) {
    console.error("An application name is required.");
    usage();
  }

  const timeoutStr = flag(argv, "timeout");
  const timeoutOverride =
    timeoutStr === undefined ? undefined : Number.parseInt(timeoutStr, 10);
  if (timeoutOverride !== undefined && Number.isNaN(timeoutOverride)) {
    console.error(`--timeout must be an integer, got: ${String(timeoutStr)}`);
    usage();
  }

  switch (subcommand) {
    case "sync":
      await sync(app, timeoutOverride ?? DEFAULT_SYNC_TIMEOUT_S, dryRun);
      return;
    case "health-wait":
      await healthWait(
        app,
        timeoutOverride ?? DEFAULT_HEALTH_TIMEOUT_S,
        dryRun,
      );
      return;
    case "wait-deletion": {
      const group = flag(argv, "group");
      const version = flag(argv, "version");
      const kind = flag(argv, "kind");
      const namespace = flag(argv, "namespace");
      if (
        group === undefined ||
        version === undefined ||
        kind === undefined ||
        namespace === undefined
      ) {
        console.error(
          "wait-deletion requires --group, --version, --kind, and --namespace",
        );
        usage();
      }
      await waitDeletion({
        appName: app,
        group,
        version,
        kind,
        namespace,
        timeoutSeconds: timeoutOverride ?? DEFAULT_DELETION_TIMEOUT_S,
        dryRun,
      });
      return;
    }
    default:
      console.error(`Unknown subcommand: ${String(subcommand)}`);
      usage();
  }
}

await main();
