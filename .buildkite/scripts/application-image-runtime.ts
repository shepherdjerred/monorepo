import { asRecord } from "../../scripts/lib/json.ts";
import { TransientError } from "../../scripts/lib/transient-error.ts";
import {
  bakeFailureIsTransient,
  retryTransientBuildx,
  type BuildxCommandResult,
} from "./bake-retry.ts";
import { parseStringArray } from "./migration-core.ts";
import { APPLICATION_IMAGE_TARGETS } from "./image-targets.ts";

export type ImageCommandExecutor = (
  command: readonly string[],
  environment?: Readonly<Record<string, string | undefined>>,
) => Promise<BuildxCommandResult>;

const applicationImageTargets = new Set(APPLICATION_IMAGE_TARGETS);

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = asRecord(value);
  if (record === null) {
    throw new TypeError("runtime fingerprint contains a non-JSON value");
  }
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

/**
 * Environment entries that carry a disposable build identity for application
 * images. The application bake injects `VERSION=<build number>` and
 * `GIT_SHA=<commit>` on every push, so including them in the runtime
 * fingerprint would make every commit look like a content change. CI images do
 * not bake these identities — any `VERSION=`/`GIT_SHA=` entry in a CI image is
 * meaningful runtime configuration — so CI callers pass a different prefix set
 * (see `CI_IMAGE_IGNORED_ENV_PREFIXES`).
 */
export const APPLICATION_IGNORED_ENV_PREFIXES: readonly string[] = [
  "GIT_SHA=",
  "VERSION=",
];

/**
 * CI images carry no disposable build identity in their runtime environment,
 * so every `Env` entry is meaningful configuration and none are stripped.
 */
export const CI_IMAGE_IGNORED_ENV_PREFIXES: readonly string[] = [];

function normalizedRuntimeConfig(
  value: unknown,
  ignoredEnvPrefixes: readonly string[],
): Record<string, unknown> {
  const config = asRecord(value);
  if (config === null) {
    throw new TypeError("image runtime config must be an object");
  }
  const normalized: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(config)) {
    if (key === "Env") {
      const environment = parseStringArray(field, "image runtime environment");
      normalized[key] = environment.filter(
        (entry) =>
          !ignoredEnvPrefixes.some((prefix) => entry.startsWith(prefix)),
      );
    } else {
      normalized[key] = field;
    }
  }
  return normalized;
}

export function runtimeFingerprintFromImage(
  value: unknown,
  ignoredEnvPrefixes: readonly string[] = APPLICATION_IGNORED_ENV_PREFIXES,
): string {
  const image = asRecord(value);
  if (image === null) throw new TypeError("image metadata must be an object");
  const architecture = image["architecture"];
  const os = image["os"];
  const rootfs = asRecord(image["rootfs"]);
  if (
    typeof architecture !== "string" ||
    typeof os !== "string" ||
    rootfs === null
  ) {
    throw new TypeError(
      "image metadata must contain architecture, os, and rootfs",
    );
  }
  const rootfsType = rootfs["type"];
  if (typeof rootfsType !== "string") {
    throw new TypeError("image rootfs must contain a type");
  }
  const diffIds = parseStringArray(rootfs["diff_ids"], "image rootfs diff_ids");
  const fingerprintInput: Record<string, unknown> = {
    architecture,
    os,
    rootfs: { type: rootfsType, diff_ids: diffIds },
    config: normalizedRuntimeConfig(image["config"], ignoredEnvPrefixes),
  };
  const variant = image["variant"];
  if (typeof variant === "string") fingerprintInput["variant"] = variant;
  const osVersion = image["os.version"];
  if (osVersion !== undefined) {
    if (typeof osVersion !== "string") {
      throw new TypeError("image os.version must be a string");
    }
    fingerprintInput["os.version"] = osVersion;
  }
  const osFeatures = image["os.features"];
  if (osFeatures !== undefined) {
    fingerprintInput["os.features"] = parseStringArray(
      osFeatures,
      "image os.features",
    );
  }
  return new Bun.CryptoHasher("sha256")
    .update(canonicalJson(fingerprintInput))
    .digest("hex");
}

export async function imageRuntimeFingerprint(
  image: string,
  executor: ImageCommandExecutor,
  ignoredEnvPrefixes: readonly string[] = APPLICATION_IGNORED_ENV_PREFIXES,
): Promise<string | undefined> {
  const result = await executor([
    "docker",
    "buildx",
    "imagetools",
    "inspect",
    image,
    "--format",
    "{{json .Image}}",
  ]);
  if (result.exitCode === 0) {
    return runtimeFingerprintFromImage(
      JSON.parse(result.stdout),
      ignoredEnvPrefixes,
    );
  }
  // A transient registry/BuildKit failure must NOT collapse to `undefined`:
  // that would rethrow a candidate failure without diagnostics (an unretryable
  // exit 1) and misclassify a pinned-image failure as `pin-unresolvable-bumped`,
  // changing the promotion outcome on a temporary blip. Preserve the diagnostics
  // as a TransientError so `runMain` exits EXIT_TRANSIENT and Buildkite retries
  // the job. Only a genuine, non-transient "not found" yields `undefined` — the
  // legitimate signal that a pin or candidate is truly unresolvable.
  if (bakeFailureIsTransient(`${result.stdout}\n${result.stderr}`)) {
    throw new TransientError(
      `Transient failure inspecting ${image}: ${
        result.stderr.trim() || result.stdout.trim()
      }`,
    );
  }
  return undefined;
}

export async function classifyRuntimeChange(
  options: {
    readonly image: string;
    readonly pinnedDigest: string;
    readonly candidateFingerprint: string;
  },
  getRuntimeFingerprint: (image: string) => Promise<string | undefined>,
): Promise<"content-unchanged" | "pin-unresolvable-bumped" | "bumped"> {
  const { image, pinnedDigest, candidateFingerprint } = options;
  const oldFingerprint = await getRuntimeFingerprint(
    `${image}@${pinnedDigest}`,
  );
  if (oldFingerprint === undefined) return "pin-unresolvable-bumped";
  return oldFingerprint === candidateFingerprint
    ? "content-unchanged"
    : "bumped";
}

export async function runExactCandidateSmoke(
  options: {
    readonly target: string;
    readonly candidate: string;
    readonly contractHash: string;
  },
  executor: ImageCommandExecutor,
  environment: Readonly<Record<string, string | undefined>>,
): Promise<void> {
  const { target, candidate, contractHash } = options;
  if (!applicationImageTargets.has(target)) {
    throw new Error(`Exact candidate smoke is not defined for ${target}`);
  }
  const exitCode = await retryTransientBuildx(() =>
    executor(
      [
        "docker",
        "buildx",
        "build",
        "--builder",
        "ci",
        "--file",
        ".buildkite/application-image-smoke.Dockerfile",
        "--build-arg",
        `CANDIDATE_IMAGE=${candidate}`,
        "--build-arg",
        `SMOKE_TARGET=${target}`,
        "--build-arg",
        `EXPECTED_CONTRACT_HASH=${contractHash}`,
        ".",
      ],
      environment,
    ),
  );
  if (exitCode !== 0) {
    throw new Error(`Exact-digest smoke failed for ${target} (${candidate})`);
  }
}
