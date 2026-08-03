import { asRecord } from "../../scripts/lib/json.ts";
import { classifyRuntimeChange } from "./application-image-runtime.ts";
import { ciImageDefinition } from "./build-ci-image-core.ts";

const DIGEST_PATTERN = /^sha256:[\da-f]{64}$/;
const COMMIT_PATTERN = /^[\da-f]{40}$/;
const PLAYWRIGHT_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const PLAYWRIGHT_IMAGE_PATTERN =
  /^FROM mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-noble@sha256:[\da-f]{64}$/gm;

export const PLAYWRIGHT_VERSION_FILE =
  ".buildkite/ci-playwright/PACKAGE_VERSION";
export const PLAYWRIGHT_PACKAGE_TARGETS = [
  {
    path: "packages/birmel/package.json",
    section: "dependencies",
    dependency: "playwright",
  },
  {
    path: "packages/monarch/package.json",
    section: "dependencies",
    dependency: "playwright",
  },
  {
    path: "packages/sjer.red/package.json",
    section: "devDependencies",
    dependency: "@playwright/test",
  },
] as const;

export type CiImagePinState = {
  readonly schema: "ci-image-pin-state/v1";
  readonly buildNumber: number;
  readonly sourceCommit: string;
  readonly sourceFingerprint: string;
  readonly digest: string;
};

export type CiImageCandidate = {
  readonly schema: "ci-image-candidate/v1";
  readonly image: "ci-base" | "ci-playwright";
  readonly buildNumber: number;
  readonly sourceCommit: string;
  readonly sourceFingerprint: string;
  readonly digest: string;
};

export type CiImageRuntimePromotionOutcome =
  | "content-unchanged"
  | "pin-unresolvable-bumped"
  | "bumped";

export type RuntimeFingerprintReader = (
  image: string,
) => Promise<string | undefined>;

function exactRecord(
  value: unknown,
  expectedKeys: readonly string[],
  description: string,
): Record<string, unknown> {
  const record = asRecord(value);
  if (record === null) {
    throw new TypeError(`${description} must be an object`);
  }
  const actual = Object.keys(record).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(`${description} contains unknown or missing fields`);
  }
  return record;
}

function canonicalDigest(value: unknown, description: string): string {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    throw new TypeError(`${description} must be a canonical sha256 digest`);
  }
  return value;
}

function positiveBuildNumber(value: unknown, allowBootstrap: boolean): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < (allowBootstrap ? 0 : 1)
  ) {
    throw new TypeError("buildNumber must be a safe positive integer");
  }
  return value;
}

function sourceIdentity(
  record: Record<string, unknown>,
  buildNumber: number,
): Pick<CiImagePinState, "sourceCommit" | "sourceFingerprint"> {
  const sourceCommit = record["sourceCommit"];
  const sourceFingerprint = record["sourceFingerprint"];
  if (buildNumber === 0) {
    if (sourceCommit !== "bootstrap" || sourceFingerprint !== "bootstrap") {
      throw new TypeError("bootstrap pin state has invalid source identity");
    }
    return { sourceCommit, sourceFingerprint };
  }
  if (typeof sourceCommit !== "string" || !COMMIT_PATTERN.test(sourceCommit)) {
    throw new TypeError("sourceCommit must be a full lowercase commit SHA");
  }
  if (
    typeof sourceFingerprint !== "string" ||
    !DIGEST_PATTERN.test(sourceFingerprint)
  ) {
    throw new TypeError("sourceFingerprint must be a canonical sha256 digest");
  }
  return { sourceCommit, sourceFingerprint };
}

export function parseCiImagePinState(value: unknown): CiImagePinState {
  const record = exactRecord(
    value,
    ["schema", "buildNumber", "sourceCommit", "sourceFingerprint", "digest"],
    "CI image pin state",
  );
  if (record["schema"] !== "ci-image-pin-state/v1") {
    throw new TypeError("CI image pin state has an unsupported schema");
  }
  const buildNumber = positiveBuildNumber(record["buildNumber"], true);
  return {
    schema: "ci-image-pin-state/v1",
    buildNumber,
    ...sourceIdentity(record, buildNumber),
    digest: canonicalDigest(record["digest"], "pin state digest"),
  };
}

export function parseCiImageCandidate(value: unknown): CiImageCandidate {
  const record = exactRecord(
    value,
    [
      "schema",
      "image",
      "buildNumber",
      "sourceCommit",
      "sourceFingerprint",
      "digest",
    ],
    "CI image candidate",
  );
  if (record["schema"] !== "ci-image-candidate/v1") {
    throw new TypeError("CI image candidate has an unsupported schema");
  }
  const definition = ciImageDefinition(
    typeof record["image"] === "string" ? record["image"] : "",
  );
  const buildNumber = positiveBuildNumber(record["buildNumber"], false);
  return {
    schema: "ci-image-candidate/v1",
    image: definition.name,
    buildNumber,
    ...sourceIdentity(record, buildNumber),
    digest: canonicalDigest(record["digest"], "candidate digest"),
  };
}

export function stateFromCandidate(
  candidate: CiImageCandidate,
): CiImagePinState {
  return {
    schema: "ci-image-pin-state/v1",
    buildNumber: candidate.buildNumber,
    sourceCommit: candidate.sourceCommit,
    sourceFingerprint: candidate.sourceFingerprint,
    digest: candidate.digest,
  };
}

/**
 * Compare the exact candidate image with the immutable pin it would replace.
 * A registry manifest digest can change without changing the filesystem or
 * runtime configuration, so only a changed runtime fingerprint merits a pin
 * PR.
 */
export async function classifyCiImageRuntimePromotion(
  options: {
    readonly repository: string;
    readonly pinnedDigest: string;
    readonly candidateDigest: string;
  },
  getRuntimeFingerprint: RuntimeFingerprintReader,
): Promise<CiImageRuntimePromotionOutcome> {
  const candidate = `${options.repository}@${options.candidateDigest}`;
  const candidateFingerprint = await getRuntimeFingerprint(candidate);
  if (candidateFingerprint === undefined) {
    throw new Error(`Could not fingerprint CI image candidate ${candidate}`);
  }
  return classifyRuntimeChange(
    {
      image: options.repository,
      pinnedDigest: options.pinnedDigest,
      candidateFingerprint,
    },
    getRuntimeFingerprint,
  );
}

export function isCurrentSourceCandidate(
  candidate: CiImagePinState,
  sourceFingerprint: string,
): boolean {
  canonicalDigest(sourceFingerprint, "current source fingerprint");
  return candidate.sourceFingerprint === sourceFingerprint;
}

function sameState(left: CiImagePinState, right: CiImagePinState): boolean {
  return (
    left.buildNumber === right.buildNumber &&
    left.sourceCommit === right.sourceCommit &&
    left.sourceFingerprint === right.sourceFingerprint &&
    left.digest === right.digest
  );
}

export function newestPinState(
  states: readonly CiImagePinState[],
): CiImagePinState {
  const first = states[0];
  if (first === undefined) {
    throw new Error("At least one CI image pin state is required");
  }
  let newest = first;
  for (const state of states.slice(1)) {
    if (state.buildNumber > newest.buildNumber) {
      newest = state;
      continue;
    }
    if (state.buildNumber === newest.buildNumber && !sameState(state, newest)) {
      throw new Error(
        `Conflicting CI image pin states for build ${state.buildNumber.toString()}`,
      );
    }
  }
  return newest;
}

export function verifyDigestFile(
  content: string,
  state: CiImagePinState,
): void {
  const digest = content.trim();
  canonicalDigest(digest, "DIGEST file");
  if (digest !== state.digest) {
    throw new Error("CI image DIGEST and STATE.json disagree");
  }
}

export function serializedState(state: CiImagePinState): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

export function playwrightVersionFromDockerfile(source: string): string {
  const versions = [...source.matchAll(PLAYWRIGHT_IMAGE_PATTERN)].map(
    (match) => match[1],
  );
  if (versions.length !== 1 || versions[0] === undefined) {
    throw new Error(
      "ci-playwright Dockerfile must contain exactly one immutable official Playwright noble image",
    );
  }
  return versions[0];
}

export function parsePlaywrightVersionFile(source: string): string {
  const version = source.trim();
  if (!PLAYWRIGHT_VERSION_PATTERN.test(version) || source !== `${version}\n`) {
    throw new Error(
      "ci-playwright PACKAGE_VERSION must contain one canonical semver line",
    );
  }
  return version;
}

function packageSection(
  source: string,
  target: (typeof PLAYWRIGHT_PACKAGE_TARGETS)[number],
): Record<string, unknown> {
  const manifest = asRecord(JSON.parse(source));
  if (manifest === null) {
    throw new TypeError(`${target.path} package manifest must be an object`);
  }
  const section = asRecord(manifest[target.section]);
  if (section === null) {
    throw new TypeError(`${target.path} is missing ${target.section}`);
  }
  return section;
}

export function playwrightPackageVersion(
  source: string,
  target: (typeof PLAYWRIGHT_PACKAGE_TARGETS)[number],
): string {
  const version = packageSection(source, target)[target.dependency];
  if (typeof version !== "string") {
    throw new TypeError(
      `${target.path} is missing ${target.section}.${target.dependency}`,
    );
  }
  return version;
}

export function rewritePlaywrightPackage(
  source: string,
  target: (typeof PLAYWRIGHT_PACKAGE_TARGETS)[number],
  version: string,
): string {
  if (!PLAYWRIGHT_VERSION_PATTERN.test(version)) {
    throw new TypeError(`Invalid Playwright package version ${version}`);
  }
  playwrightPackageVersion(source, target);
  const expression =
    target.dependency === "playwright"
      ? /^(\s*"playwright":\s*)"[^"]+"(,?)$/gm
      : /^(\s*"@playwright\/test":\s*)"[^"]+"(,?)$/gm;
  const matches = [...source.matchAll(expression)];
  if (matches.length !== 1) {
    throw new Error(
      `${target.path} must declare ${target.dependency} exactly once`,
    );
  }
  return source.replaceAll(expression, `$1"${version}"$2`);
}

export function ciImagePromotionFiles(
  image: CiImageCandidate["image"],
): readonly string[] {
  const definition = ciImageDefinition(image);
  if (image === "ci-base") {
    return [definition.digestFile, definition.stateFile];
  }
  return [
    definition.digestFile,
    definition.stateFile,
    PLAYWRIGHT_VERSION_FILE,
    ...PLAYWRIGHT_PACKAGE_TARGETS.map((target) => target.path),
    "bun.lock",
  ];
}
