#!/usr/bin/env bun
/**
 * Pull Xcode Cloud build logs for Tasks for Obsidian via the App Store Connect API.
 *
 * There are no macOS CI agents in the monorepo (see docs/todos/mac-mini-buildkite-agent.md),
 * so iOS release builds run on Apple's Xcode Cloud. When an Archive fails, the only signal
 * is a terse email ("Command PhaseScriptExecution failed with a nonzero exit code"). This
 * script fetches the real build logs so the failing command + stderr are visible locally.
 *
 * Credentials live in 1Password (item "App Store Connect API — Xcode Cloud", Personal vault):
 *   - credential : the App Store Connect API private key (.p8, ES256)
 *   - key id     : the 10-char Key ID
 *   - issuer id  : the team Issuer ID (UUID)
 * Nothing secret is baked into this file; the key never touches disk in the repo.
 *
 * Usage:
 *   bun scripts/xcode-cloud-logs.ts runs                 # list recent runs; in-progress ones expand per-action
 *   bun scripts/xcode-cloud-logs.ts status               # per-action breakdown of the newest run (no downloads)
 *   bun scripts/xcode-cloud-logs.ts status <sel>         # ...of a specific run (see selectors below)
 *   bun scripts/xcode-cloud-logs.ts logs <sel>           # download every action's logs + artifacts
 *   bun scripts/xcode-cloud-logs.ts logs <sel> ./out-dir # custom output directory
 *
 * A run <sel>ector is any of: a build number (`62` or `#62`), a build-run UUID,
 * `latest` (newest run), or `latest-failed` (newest FAILED run).
 *
 * A build run has two actions — Archive (compile/bundle/sign) then TestFlight
 * (upload/distribute). The overall run stays "RUNNING" until BOTH finish, so a
 * green Archive can look stuck when it's really the TestFlight step waiting on
 * App Store Connect. `status` (and the auto-expanded in-progress rows in `runs`)
 * shows each action separately so that's obvious. `status` needs no downloads;
 * `logs` pulls the LOG_BUNDLE/RESULT_BUNDLE/exported .ipa artifacts (tens of MB).
 *
 * The default output directory is ./xcode-cloud-logs/<buildRunId>/ (gitignored scratch).
 */
import { execFileSync } from "node:child_process";
import { createSign } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { z } from "zod";

const OP_ITEM = "App Store Connect API — Xcode Cloud";
const OP_VAULT = "Personal";
const API_BASE = "https://api.appstoreconnect.apple.com";
const JWT_AUDIENCE = "appstoreconnect-v1";
// TasksForObsidian Xcode Cloud product. Stable per-app; list via `ciProducts` if it ever changes.
const PRODUCT_ID = "98D77B20-0714-4B60-BFC4-79B4948CAE89";

type Creds = { privateKey: string; keyId: string; issuerId: string };

const OpFieldSchema = z.array(
  z.object({ label: z.string(), value: z.string() }),
);

/** Read the private key + Key ID + Issuer ID from 1Password in a single biometric-gated call. */
function loadCreds(): Creds {
  let stdout: string;
  try {
    stdout = execFileSync(
      "op",
      [
        "item",
        "get",
        OP_ITEM,
        "--vault",
        OP_VAULT,
        "--format",
        "json",
        "--reveal",
        "--fields",
        "credential,key id,issuer id",
      ],
      { encoding: "utf8" },
    );
  } catch (error: unknown) {
    throw new Error(
      `op item get failed: ${error instanceof Error ? error.message : String(error)}`,
      {
        cause: error,
      },
    );
  }
  const fields = OpFieldSchema.parse(JSON.parse(stdout));
  const byLabel = (label: string): string => {
    const found = fields.find((f) => f.label === label);
    if (!found)
      throw new Error(
        `1Password item "${OP_ITEM}" is missing field "${label}"`,
      );
    return found.value;
  };
  return {
    privateKey: byLabel("credential"),
    keyId: byLabel("key id"),
    issuerId: byLabel("issuer id"),
  };
}

function base64Url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

/** Mint a short-lived ES256 JWT. App Store Connect requires the raw R||S signature (IEEE P1363), not DER. */
function mintJwt(creds: Creds): string {
  const header = { alg: "ES256", kid: creds.keyId, typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: creds.issuerId,
    iat: now,
    exp: now + 600,
    aud: JWT_AUDIENCE,
  };
  const signingInput = `${base64Url(Buffer.from(JSON.stringify(header)))}.${base64Url(Buffer.from(JSON.stringify(payload)))}`;
  const signer = createSign("SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign({
    key: creds.privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${base64Url(signature)}`;
}

async function api(creds: Creds, pathOrUrl: string): Promise<unknown> {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : API_BASE + pathOrUrl;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${mintJwt(creds)}` },
  });
  if (!res.ok) {
    throw new Error(
      `GET ${url} -> ${res.status} ${res.statusText}\n${await res.text()}`,
    );
  }
  return res.json();
}

const BuildRunsSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      attributes: z.object({
        number: z.number().nullish(),
        createdDate: z.string().nullish(),
        executionProgress: z.string().nullish(),
        completionStatus: z.string().nullish(),
      }),
    }),
  ),
});

const ActionSchema = z.object({
  id: z.string(),
  attributes: z.object({
    name: z.string().nullish(),
    actionType: z.string().nullish(),
    executionProgress: z.string().nullish(),
    completionStatus: z.string().nullish(),
    startedDate: z.string().nullish(),
    finishedDate: z.string().nullish(),
  }),
});
type Action = z.infer<typeof ActionSchema>;
const ActionsSchema = z.object({ data: z.array(ActionSchema) });

type BuildRun = z.infer<typeof BuildRunsSchema>["data"][number];

const ArtifactsSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      attributes: z.object({
        fileName: z.string().nullish(),
        fileType: z.string().nullish(),
        fileSize: z.number().nullish(),
        downloadUrl: z.string().nullish(),
      }),
    }),
  ),
});

/** Compact human duration: "45s", "12m", "4h32m". */
function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${String(hours)}h${String(minutes)}m`;
  if (minutes > 0) return `${String(minutes)}m`;
  return `${String(totalSeconds)}s`;
}

/** "4h32m ago" for an ISO timestamp, or "?" if absent/unparseable. */
function ageSince(iso: string | null | undefined): string {
  if (!iso) return "?";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "?";
  return `${formatDuration(Date.now() - then)} ago`;
}

/** A glyph that reads at a glance for a completion/progress state. */
function statusGlyph(status: string): string {
  switch (status) {
    case "SUCCEEDED":
    case "COMPLETE":
      return "✓";
    case "FAILED":
    case "ERRORED":
      return "✗";
    case "CANCELED":
      return "⊘";
    case "SKIPPED":
      return "–";
    case "RUNNING":
      return "▶";
    case "PENDING":
      return "…";
    default:
      return "?";
  }
}

/**
 * The one status that best describes a run/action: its final completionStatus
 * once set, otherwise its live executionProgress (RUNNING/PENDING). This is why
 * a build reads "RUNNING" until every action reports a completionStatus.
 */
function overallStatus(a: {
  completionStatus?: string | null;
  executionProgress?: string | null;
}): string {
  return a.completionStatus ?? a.executionProgress ?? "?";
}

async function fetchActions(
  creds: Creds,
  buildRunId: string,
): Promise<Action[]> {
  return ActionsSchema.parse(
    await api(
      creds,
      `/v1/ciBuildRuns/${buildRunId}/actions?limit=50&fields[ciBuildActions]=name,actionType,executionProgress,completionStatus,startedDate,finishedDate`,
    ),
  ).data;
}

/** Print one indented line per action: glyph, name, type, status, and elapsed time. */
function printActions(actions: Action[]): void {
  for (const action of actions) {
    const a = action.attributes;
    const status = overallStatus(a);
    let timing = "";
    if (a.startedDate) {
      const started = Date.parse(a.startedDate);
      const ended = a.finishedDate ? Date.parse(a.finishedDate) : Date.now();
      if (!Number.isNaN(started) && !Number.isNaN(ended)) {
        timing = ` (${formatDuration(ended - started)}${a.finishedDate ? "" : " so far"})`;
      }
    }
    console.log(
      `  ${statusGlyph(status)} ${a.name ?? "?"} [${a.actionType ?? "?"}] -> ${status}${timing}`,
    );
  }
}

/** True while a run has not reached a terminal completionStatus. */
function isInProgress(run: BuildRun): boolean {
  return (
    !run.attributes.completionStatus &&
    run.attributes.executionProgress !== "COMPLETE"
  );
}

/** Resolve a run selector (`62`, `#62`, UUID, `latest`, `latest-failed`) against a fetched list. */
function pickRun(
  runs: BuildRun[],
  selector: string | undefined,
): BuildRun | undefined {
  if (!selector || selector === "latest") return runs[0];
  if (selector === "latest-failed") {
    return runs.find((r) => r.attributes.completionStatus === "FAILED");
  }
  const asNumber = selector.replace(/^#/, "");
  return runs.find(
    (r) => r.id === selector || String(r.attributes.number) === asNumber,
  );
}

async function listRuns(creds: Creds) {
  const data = BuildRunsSchema.parse(
    await api(
      creds,
      `/v1/ciProducts/${PRODUCT_ID}/buildRuns?limit=20&sort=-number&fields[ciBuildRuns]=number,createdDate,executionProgress,completionStatus`,
    ),
  );
  return data.data;
}

async function resolveBuildRunId(
  creds: Creds,
  selector: string,
): Promise<string> {
  // A raw build-run UUID resolves without a list call.
  if (/^[0-9a-f-]{36}$/i.test(selector)) return selector;
  const runs = await listRuns(creds);
  const target = pickRun(runs, selector);
  if (!target) {
    throw new Error(
      `Could not resolve build run for "${selector}" among the last ${String(runs.length)} runs.`,
    );
  }
  console.log(
    `Resolved ${selector} -> build #${String(target.attributes.number)} (${target.id})`,
  );
  return target.id;
}

async function downloadLogs(creds: Creds, buildRunId: string, outDir: string) {
  mkdirSync(outDir, { recursive: true });
  const actions = await fetchActions(creds, buildRunId);

  console.log(
    `Build run ${buildRunId} has ${String(actions.length)} action(s):`,
  );
  printActions(actions);

  for (const action of actions) {
    const artifacts = ArtifactsSchema.parse(
      await api(
        creds,
        `/v1/ciBuildActions/${action.id}/artifacts?limit=50&fields[ciArtifacts]=fileName,fileType,fileSize,downloadUrl`,
      ),
    ).data;

    for (const art of artifacts) {
      const { downloadUrl, fileName, fileType, fileSize } = art.attributes;
      if (!downloadUrl) continue;
      const actionName = (action.attributes.name ?? action.id).replaceAll(
        /[^\w.-]+/g,
        "_",
      );
      const safeFileName = (fileName ?? art.id).replaceAll(/[^\w.-]+/g, "_");
      const safeFileType = (fileType ?? "artifact").replaceAll(
        /[^\w.-]+/g,
        "_",
      );
      const safeName = `${actionName}__${safeFileType}__${safeFileName}`;
      console.log(`Downloading ${safeName} (${fileSize ?? "?"} bytes)...`);
      const bin = await fetch(downloadUrl);
      if (!bin.ok) {
        if (fileType === "LOG_BUNDLE") {
          throw new Error(
            `Failed to download LOG_BUNDLE artifact ${safeName}: ${String(bin.status)} ${bin.statusText}`,
          );
        }
        console.log(`  !! ${bin.status} ${bin.statusText}`);
        continue;
      }
      writeFileSync(
        `${outDir}/${safeName}`,
        Buffer.from(await bin.arrayBuffer()),
      );
    }
  }
  console.log(
    `\nSaved to ${outDir}\nLog bundles are .zip — unzip and look for "Command PhaseScriptExecution failed" or "error:".`,
  );
}

async function main() {
  const [cmd, arg, arg2] = process.argv.slice(2);
  const creds = loadCreds();

  if (cmd === "runs") {
    const runs = await listRuns(creds);
    for (const r of runs) {
      const a = r.attributes;
      console.log(
        `#${String(a.number)}\t${overallStatus(a)}\t${ageSince(a.createdDate)}\t${r.id}`,
      );
      // Expand still-running builds so it's clear which action is the holdup
      // (e.g. Archive done, TestFlight uploading) rather than a bare "RUNNING".
      if (isInProgress(r)) {
        printActions(await fetchActions(creds, r.id));
      }
    }
    return;
  }

  if (cmd === "status") {
    const runs = await listRuns(creds);
    const target = pickRun(runs, arg);
    const buildRunId = target?.id ?? arg;
    if (!buildRunId)
      throw new Error(
        "Usage: status <#number | buildRunId | latest | latest-failed>",
      );
    if (target) {
      const a = target.attributes;
      console.log(
        `#${String(a.number)}  ${overallStatus(a)}  started ${ageSince(a.createdDate)}  ${target.id}`,
      );
    } else {
      console.log(`Build run ${buildRunId}`);
    }
    printActions(await fetchActions(creds, buildRunId));
    return;
  }

  if (cmd === "logs") {
    if (!arg)
      throw new Error(
        "Usage: logs <#number | buildRunId | latest | latest-failed> [outDir]",
      );
    const buildRunId = await resolveBuildRunId(creds, arg);
    const outDir = arg2 ?? `./xcode-cloud-logs/${buildRunId}`;
    await downloadLogs(creds, buildRunId, outDir);
    return;
  }

  throw new Error(
    `Unknown command: ${cmd ?? "(none)"}\n` +
      "Usage:\n" +
      "  bun scripts/xcode-cloud-logs.ts runs\n" +
      "  bun scripts/xcode-cloud-logs.ts status [#number | buildRunId | latest | latest-failed]\n" +
      "  bun scripts/xcode-cloud-logs.ts logs <#number | buildRunId | latest | latest-failed> [outDir]",
  );
}

try {
  await main();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
