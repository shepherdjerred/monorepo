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
 *   bun scripts/xcode-cloud-logs.ts runs                 # list recent build runs (newest first)
 *   bun scripts/xcode-cloud-logs.ts logs <buildRunId>    # download every action's logs
 *   bun scripts/xcode-cloud-logs.ts logs latest-failed   # resolve + download the newest FAILED run
 *   bun scripts/xcode-cloud-logs.ts logs <id> ./out-dir  # custom output directory
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

const ActionsSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      attributes: z.object({
        name: z.string().nullish(),
        actionType: z.string().nullish(),
        completionStatus: z.string().nullish(),
        startedDate: z.string().nullish(),
        finishedDate: z.string().nullish(),
      }),
    }),
  ),
});

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

async function listRuns(creds: Creds) {
  const data = BuildRunsSchema.parse(
    await api(
      creds,
      `/v1/ciProducts/${PRODUCT_ID}/buildRuns?limit=20&sort=-number&fields[ciBuildRuns]=number,createdDate,executionProgress,completionStatus`,
    ),
  );
  return data.data;
}

async function resolveBuildRunId(creds: Creds, arg: string): Promise<string> {
  if (arg !== "latest-failed") return arg;
  const runs = await listRuns(creds);
  const failed = runs.find((r) => r.attributes.completionStatus === "FAILED");
  if (!failed)
    throw new Error("No FAILED build run found in the last 20 runs.");
  console.log(
    `Resolved latest-failed -> build #${String(failed.attributes.number)} (${failed.id})`,
  );
  return failed.id;
}

async function downloadLogs(creds: Creds, buildRunId: string, outDir: string) {
  mkdirSync(outDir, { recursive: true });
  const actions = ActionsSchema.parse(
    await api(
      creds,
      `/v1/ciBuildRuns/${buildRunId}/actions?limit=50&fields[ciBuildActions]=name,actionType,completionStatus,startedDate,finishedDate`,
    ),
  ).data;

  console.log(`Build run ${buildRunId} has ${actions.length} action(s):`);
  for (const a of actions) {
    const { name, actionType, completionStatus } = a.attributes;
    console.log(
      `  - ${name ?? "?"} [${actionType ?? "?"}] -> ${completionStatus ?? "?"}`,
    );
  }

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
      const safeName = `${actionName}__${fileType ?? "artifact"}__${safeFileName}`;
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
      const status = a.completionStatus ?? a.executionProgress ?? "?";
      console.log(
        `#${String(a.number)}\t${status}\t${a.createdDate ?? "?"}\t${r.id}`,
      );
    }
    return;
  }

  if (cmd === "logs") {
    if (!arg)
      throw new Error("Usage: logs <buildRunId | latest-failed> [outDir]");
    const buildRunId = await resolveBuildRunId(creds, arg);
    const outDir = arg2 ?? `./xcode-cloud-logs/${buildRunId}`;
    await downloadLogs(creds, buildRunId, outDir);
    return;
  }

  throw new Error(
    `Unknown command: ${cmd ?? "(none)"}\n` +
      "Usage:\n" +
      "  bun scripts/xcode-cloud-logs.ts runs\n" +
      "  bun scripts/xcode-cloud-logs.ts logs <buildRunId | latest-failed> [outDir]",
  );
}

try {
  await main();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
