import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { run } from "../lib/run.ts";

export type RenovateDryRunMode = "extract" | "lookup";

const USAGE =
  "Usage: bun run renovate-dry-run [extract|lookup] [--report-path <path>] [--isolated-checkout]";
// renovate: datasource=npm depName=renovate
const RENOVATE_CLI_VERSION = "44.263.6";

const PLACEHOLDER_TOKENS = new Set([
  "unused",
  "placeholder",
  "dummy",
  "test",
  "fake",
]);

const SECRET_TEMPLATE_RE = /\{\{\s*secrets\.(\w+)\s*\}\}/gu;

const SecretsRecordSchema = z.record(z.string(), z.string());
const ConfigRecordSchema = z.record(z.string(), z.unknown());

/**
 * True when a Docker Hub token value is an empty or placeholder string that
 * would send failed logins for `shepherdjerred` on `docker.io` and trigger a
 * Docker Hub account lockout.
 */
export function isPlaceholderDockerHubToken(value: string): boolean {
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  return (
    trimmed.length === 0 ||
    PLACEHOLDER_TOKENS.has(lower) ||
    (trimmed.startsWith("<") && trimmed.endsWith(">"))
  );
}

function rejectPlaceholderToken(): never {
  throw new Error(
    "Refusing placeholder DOCKERHUB_RENOVATE_TOKEN: placeholder values send failed logins to docker.io and lock the shared Docker Hub account. Omit DOCKERHUB_RENOVATE_TOKEN so renovate-dry-run strips unprovided secret hostRules.",
  );
}

function parseSecretsJson(rawSecrets: string): Record<string, string> {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawSecrets);
  } catch {
    throw new Error(
      "RENOVATE_SECRETS must be a JSON object mapping secret names to strings",
    );
  }
  const parsed = SecretsRecordSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error(
      "RENOVATE_SECRETS must be a JSON object mapping secret names to strings",
    );
  }
  return parsed.data;
}

function validateSecretEntry(name: string, value: string): string | null {
  if (name === "DOCKERHUB_RENOVATE_TOKEN") {
    if (isPlaceholderDockerHubToken(value)) rejectPlaceholderToken();
    return value;
  }
  return value.trim() === "" ? null : value;
}

/**
 * Parse and validate Renovate secrets from `RENOVATE_SECRETS` and
 * `DOCKERHUB_RENOVATE_TOKEN`, rejecting placeholder Docker Hub tokens.
 */
export function resolveRenovateSecrets(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  const rawSecrets = env["RENOVATE_SECRETS"];
  if (rawSecrets !== undefined && rawSecrets.trim() !== "") {
    for (const [name, value] of Object.entries(parseSecretsJson(rawSecrets))) {
      const validated = validateSecretEntry(name, value);
      if (validated !== null) resolved[name] = validated;
    }
  }

  const directToken = env["DOCKERHUB_RENOVATE_TOKEN"];
  if (directToken !== undefined && directToken !== "") {
    if (isPlaceholderDockerHubToken(directToken)) rejectPlaceholderToken();
    resolved["DOCKERHUB_RENOVATE_TOKEN"] ??= directToken;
  }

  return resolved;
}

function collectSecretReferences(value: unknown, names: Set<string>): void {
  if (typeof value === "string") {
    for (const match of value.matchAll(SECRET_TEMPLATE_RE)) {
      const secretName = match[1];
      if (secretName !== undefined) names.add(secretName);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectSecretReferences(item, names);
    return;
  }
  const record = ConfigRecordSchema.safeParse(value);
  if (record.success) {
    for (const field of Object.values(record.data)) {
      collectSecretReferences(field, names);
    }
  }
}

/**
 * Return a copy of `renovate.json` with any `hostRules` entries referencing
 * unprovided `{{ secrets.* }}` placeholders removed so local dry runs never
 * attempt failed authenticated logins against `docker.io`.
 */
export function sanitizeRenovateConfig(
  config: Readonly<Record<string, unknown>>,
  providedSecrets: Readonly<Record<string, string>>,
): Record<string, unknown> {
  const hostRules = config["hostRules"];
  if (!Array.isArray(hostRules)) return { ...config };
  const retained = hostRules.filter((rule) => {
    const referenced = new Set<string>();
    collectSecretReferences(rule, referenced);
    for (const name of referenced) {
      const provided = providedSecrets[name];
      if (provided === undefined || provided.trim() === "") return false;
    }
    return true;
  });
  if (retained.length === 0) {
    const { hostRules: _omitted, ...rest } = config;
    return rest;
  }
  return { ...config, hostRules: retained };
}

function parseReportPathOption(
  arg: string,
  next: string | undefined,
): { value: string; consumedNext: boolean } | null {
  if (arg === "--report-path") {
    if (next === undefined || next === "" || next.startsWith("-")) {
      throw new Error(USAGE);
    }
    return { value: next, consumedNext: true };
  }
  if (arg.startsWith("--report-path=")) {
    const inline = arg.slice("--report-path=".length);
    if (inline === "") throw new Error(USAGE);
    return { value: inline, consumedNext: false };
  }
  return null;
}

export function parseRenovateDryRunArgs(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>> = Bun.env,
): { mode: RenovateDryRunMode; reportPath: string; isolatedCheckout?: true } {
  let mode: RenovateDryRunMode | undefined;
  let reportPath: string | undefined;
  let isolatedCheckout = false;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === undefined) continue;
    if (arg === "--isolated-checkout") {
      isolatedCheckout = true;
      continue;
    }
    const parsedReportPath = parseReportPathOption(arg, args[index + 1]);
    if (parsedReportPath !== null) {
      reportPath = parsedReportPath.value;
      if (parsedReportPath.consumedNext) index += 1;
      continue;
    }
    if (mode === undefined && (arg === "extract" || arg === "lookup")) {
      mode = arg;
      continue;
    }
    throw new Error(USAGE);
  }

  const resolvedMode = mode ?? "extract";
  const tmpBase =
    env["TMPDIR"] === undefined || env["TMPDIR"] === ""
      ? tmpdir()
      : env["TMPDIR"];
  return {
    mode: resolvedMode,
    reportPath:
      reportPath ?? path.join(tmpBase, `renovate-${resolvedMode}.json`),
    ...(isolatedCheckout ? { isolatedCheckout: true } : {}),
  };
}

export async function runRenovateDryRun(
  args: readonly string[],
  options?: {
    cwd?: string;
    env?: Readonly<Record<string, string | undefined>>;
    runner?: typeof run;
    signal?: AbortSignal;
  },
): Promise<{ mode: RenovateDryRunMode; reportPath: string }> {
  const cwd = options?.cwd ?? fileURLToPath(new URL("../..", import.meta.url));
  const env = options?.env ?? Bun.env;
  const runner = options?.runner ?? run;
  const { mode, reportPath, isolatedCheckout } = parseRenovateDryRunArgs(
    args,
    env,
  );
  const secrets = resolveRenovateSecrets(env);
  const repoConfigPath = path.join(cwd, "renovate.json");
  const rawText = await Bun.file(repoConfigPath).text();
  const rawConfig = ConfigRecordSchema.parse(JSON.parse(rawText));
  const sanitized = sanitizeRenovateConfig(rawConfig, secrets);
  const tempDir = await mkdtemp(path.join(tmpdir(), "renovate-dry-run-"));
  const tempConfigPath = path.join(tempDir, "renovate.json");
  try {
    // The local platform rereads the tracked config even when the
    // require-config CLI flag is set. The disposable worker clone can
    // safely present one sanitized repository config and restore it after.
    const globalConfig = isolatedCheckout
      ? { allowedEnv: ["BUN_CONFIG_MAX_HTTP_REQUESTS"] }
      : { ...sanitized, allowedEnv: ["BUN_CONFIG_MAX_HTTP_REQUESTS"] };
    if (isolatedCheckout) {
      await Bun.write(
        repoConfigPath,
        `${JSON.stringify(sanitized, null, 2)}\n`,
      );
    }
    await Bun.write(
      tempConfigPath,
      `${JSON.stringify(globalConfig, null, 2)}\n`,
    );
    await runner(
      [
        "bunx",
        `renovate@${RENOVATE_CLI_VERSION}`,
        "--platform=local",
        "--require-config=ignored",
        `--dry-run=${mode}`,
        "--report-type=file",
        `--report-path=${reportPath}`,
      ],
      {
        cwd,
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
        env: {
          RENOVATE_CONFIG_FILE: tempConfigPath,
          RENOVATE_SECRETS: JSON.stringify(secrets),
        },
        unsetEnv: ["DOCKERHUB_RENOVATE_TOKEN", "RENOVATE_ALLOWED_ENV"],
      },
    );
    return { mode, reportPath };
  } finally {
    try {
      if (isolatedCheckout) await Bun.write(repoConfigPath, rawText);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

if (import.meta.main) {
  const cancellation = new AbortController();
  const cancel = () => {
    cancellation.abort();
  };
  process.once("SIGTERM", cancel);
  try {
    await runRenovateDryRun(Bun.argv.slice(2), { signal: cancellation.signal });
  } finally {
    process.removeListener("SIGTERM", cancel);
  }
}
