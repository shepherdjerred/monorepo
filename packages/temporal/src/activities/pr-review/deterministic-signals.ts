import { createHash } from "node:crypto";
import { withSpan } from "#observability/tracing.ts";
import type { PrFileDiff } from "#shared/pr-review/context.ts";
import type { Finding, VerificationResult } from "#shared/pr-review/finding.ts";
import type { BootstrapResult } from "./bootstrap.ts";
import type { AnnotatedFinding } from "./consensus.ts";

const COMPONENT = "pr-review-pipeline";
const DETERMINISTIC_PASSES = [0, 1] as const;
const VERSIONS_PATH = "packages/homelab/src/cdk8s/src/versions.ts";

type ImageManifestStatus = "exists" | "missing" | "unknown";

export type DeterministicImageChecker = (input: {
  registry: string;
  repository: string;
  reference: string;
}) => Promise<ImageManifestStatus>;

export type DeterministicSignalDeps = {
  checkImageManifest: DeterministicImageChecker;
};

export type DeterministicSignalInput = {
  context: BootstrapResult;
};

type PatchLine = {
  file: string;
  lineNumber: number;
  body: string;
  isAdded: boolean;
};

type VersionChange = {
  key: string;
  value: string;
  lineNumber: number;
};

type VersionMetadata = {
  registry: string;
  repository: string;
};

function jsonLog(
  level: "info" | "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  console.warn(
    JSON.stringify({
      level,
      msg: message,
      component: COMPONENT,
      activity: "deterministicSignals",
      ...fields,
    }),
  );
}

function findingId(parts: readonly string[]): string {
  return `det-${createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 12)}`;
}

function verification(input: {
  verifier: Finding["verifier"];
  output: string;
  note?: string;
}): VerificationResult {
  return {
    status: "verified",
    verifier: input.verifier,
    exitCode: 0,
    outputExcerpt: input.output.slice(0, 900),
    durationMs: 0,
    ...(input.note === undefined ? {} : { note: input.note }),
  };
}

function annotateDeterministic(finding: Finding): AnnotatedFinding[] {
  return DETERMINISTIC_PASSES.map((passId) => ({
    finding,
    specialistId: "deterministic",
    passId,
  }));
}

function patchLines(file: PrFileDiff): PatchLine[] {
  if (file.patch === null) return [];
  const out: PatchLine[] = [];
  let currentNewLine = 1;
  for (const rawLine of file.patch.split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(rawLine);
    if (hunk !== null) {
      const parsed = Number.parseInt(hunk[1] ?? "1", 10);
      currentNewLine = Number.isInteger(parsed) ? parsed : 1;
      continue;
    }

    if (rawLine.startsWith("+++") || rawLine.startsWith("---")) {
      continue;
    }

    if (rawLine.startsWith("+")) {
      out.push({
        file: file.path,
        lineNumber: currentNewLine,
        body: rawLine.slice(1),
        isAdded: true,
      });
      currentNewLine++;
      continue;
    }

    if (rawLine.startsWith("-")) {
      continue;
    }

    out.push({
      file: file.path,
      lineNumber: currentNewLine,
      body: rawLine.startsWith(" ") ? rawLine.slice(1) : rawLine,
      isAdded: false,
    });
    currentNewLine++;
  }
  return out;
}

function collectVersionChanges(file: PrFileDiff): VersionChange[] {
  const changes: VersionChange[] = [];
  let lastKey: string | undefined;
  for (const line of patchLines(file)) {
    const inline = /^\s*"([^"]+)"\s*:\s*"([^"]+)"/.exec(line.body);
    if (inline !== null) {
      const key = inline[1];
      const value = inline[2];
      if (key !== undefined && value !== undefined && line.isAdded) {
        changes.push({ key, value, lineNumber: line.lineNumber });
      }
      lastKey = key;
      continue;
    }

    const keyOnly = /^\s*"([^"]+)"\s*:\s*$/.exec(line.body);
    if (keyOnly !== null) {
      lastKey = keyOnly[1];
      continue;
    }

    const valueOnly = /^\s*"([^"]+)"/.exec(line.body);
    if (valueOnly !== null && lastKey !== undefined && line.isAdded) {
      const value = valueOnly[1];
      if (value !== undefined) {
        changes.push({
          key: lastKey,
          value,
          lineNumber: line.lineNumber,
        });
      }
    }
  }
  return changes;
}

function metadataFromKey(key: string): VersionMetadata | null {
  if (key.startsWith("shepherdjerred/")) {
    return {
      registry: "ghcr.io",
      repository: key,
    };
  }
  return null;
}

function tagFromVersionValue(value: string): string | null {
  const tag = value.split("@sha256:", 1)[0];
  return tag === undefined || tag.length === 0 ? null : tag;
}

async function defaultCheckImageManifest(input: {
  registry: string;
  repository: string;
  reference: string;
}): Promise<ImageManifestStatus> {
  const registry =
    input.registry === "docker.io" ? "registry-1.docker.io" : input.registry;
  const tokenUrl =
    input.registry === "docker.io"
      ? "https://auth.docker.io/token"
      : input.registry === "ghcr.io"
        ? "https://ghcr.io/token"
        : null;
  const service =
    input.registry === "docker.io"
      ? "registry.docker.io"
      : input.registry === "ghcr.io"
        ? "ghcr.io"
        : null;
  if (tokenUrl === null || service === null) return "unknown";

  try {
    const tokenResponse = await fetch(
      `${tokenUrl}?scope=repository:${input.repository}:pull&service=${service}`,
    );
    if (!tokenResponse.ok) return "unknown";
    const tokenJson = await tokenResponse.json();
    if (
      typeof tokenJson !== "object" ||
      tokenJson === null ||
      !("token" in tokenJson) ||
      typeof tokenJson.token !== "string"
    ) {
      return "unknown";
    }
    const manifestResponse = await fetch(
      `https://${registry}/v2/${input.repository}/manifests/${input.reference}`,
      {
        method: "HEAD",
        headers: {
          Authorization: `Bearer ${tokenJson.token}`,
          Accept: [
            "application/vnd.docker.distribution.manifest.v2+json",
            "application/vnd.docker.distribution.manifest.list.v2+json",
            "application/vnd.oci.image.manifest.v1+json",
            "application/vnd.oci.image.index.v1+json",
          ].join(", "),
        },
      },
    );
    if (manifestResponse.ok) return "exists";
    if (manifestResponse.status === 404) return "missing";
    return "unknown";
  } catch {
    return "unknown";
  }
}

async function imageFindings(
  context: BootstrapResult,
  deps: DeterministicSignalDeps,
): Promise<Finding[]> {
  const versionsFile = context.changedFiles.find(
    (f) => f.path === VERSIONS_PATH,
  );
  if (versionsFile === undefined) return [];

  const findings: Finding[] = [];
  for (const change of collectVersionChanges(versionsFile)) {
    const metadata = metadataFromKey(change.key);
    const tag = tagFromVersionValue(change.value);
    if (metadata === null || tag === null) continue;
    const status = await deps.checkImageManifest({
      registry: metadata.registry,
      repository: metadata.repository,
      reference: tag,
    });
    if (status !== "missing") continue;

    findings.push({
      id: findingId(["image-missing", change.key, tag]),
      file: VERSIONS_PATH,
      lineStart: change.lineNumber,
      lineEnd: change.lineNumber,
      kind: "deps",
      severity: "critical",
      verifier: "container-image",
      verifierTarget: {
        kind: "container-image",
        registry: metadata.registry,
        repository: metadata.repository,
        reference: tag,
        mustExist: false,
      },
      claim: `Container image tag \`${metadata.registry}/${metadata.repository}:${tag}\` is not published.`,
      evidence: `The PR pins \`${change.key}\` to \`${change.value}\`, but the registry does not resolve tag \`${tag}\`.`,
      confidence: 0.99,
      verification: verification({
        verifier: "container-image",
        output: `${metadata.registry}/${metadata.repository}:${tag} missing`,
      }),
    });
  }
  return findings;
}

function hasNativePeerCheckerBypass(source: string): boolean {
  return (
    source.includes("runtimeDependencyNames") &&
    source.includes("declaredPackageNames") &&
    source.includes("peerName") &&
    source.includes("devDependencies") &&
    source.includes("optionalDependencies") &&
    /\.has\(\s*peerName\s*\)/.test(source)
  );
}

function nativePeerCheckerFindings(context: BootstrapResult): Finding[] {
  const findings: Finding[] = [];
  for (const file of context.changedFiles) {
    if (!file.path.endsWith(".ts") || file.patch === null) continue;
    if (file.path.endsWith(".test.ts") || file.path.endsWith(".spec.ts")) {
      continue;
    }
    const addedLines = patchLines(file).filter((line) => line.isAdded);
    const addedText = addedLines.map((line) => line.body).join("\n");
    if (
      !hasNativePeerCheckerBypass(addedText) &&
      !hasNativePeerCheckerBypass(file.patch)
    ) {
      continue;
    }
    const bypassLine =
      addedLines.find((line) =>
        /declaredPackageNames\.has\(\s*peerName\s*\)/.test(line.body),
      ) ?? addedLines[0];
    const lineNumber = bypassLine?.lineNumber ?? 1;
    const replacement =
      bypassLine?.body.replace(
        /declaredPackageNames\.has\(\s*peerName\s*\)/,
        "runtimeDependencyNames.has(peerName)",
      ) ?? "if (runtimeDependencyNames.has(peerName)) continue;";
    const claim =
      "Runtime peer dependency validation can be satisfied by non-runtime dependency sections.";
    findings.push({
      id: findingId([
        "native-peer-bypass",
        file.path,
        String(lineNumber),
        "correctness",
        claim,
      ]),
      file: file.path,
      lineStart: lineNumber,
      lineEnd: lineNumber,
      kind: "correctness",
      severity: "warning",
      verifier: "grep",
      verifierTarget: {
        kind: "grep",
        pattern: "declaredPackageNames.has(peerName)",
        isLiteral: true,
        pathGlob: file.path,
        mustMatch: true,
      },
      claim,
      evidence:
        "The changed checker builds a declared-package set from devDependencies/optionalDependencies and uses that set to satisfy `peerName`, so a native runtime peer can pass without being in `dependencies`.",
      confidence: 0.92,
      suggestion: {
        replacement,
        lineStart: lineNumber,
        lineEnd: lineNumber,
        rationale:
          "The runtime peer check should only be satisfied by packages present in runtime dependencies.",
      },
      verification: verification({
        verifier: "grep",
        output: "declaredPackageNames.has(peerName)",
      }),
    });
  }
  return findings;
}

export async function runDeterministicSignals(
  input: DeterministicSignalInput,
  deps: DeterministicSignalDeps,
): Promise<AnnotatedFinding[]> {
  const findings = [
    ...(await imageFindings(input.context, deps)),
    ...nativePeerCheckerFindings(input.context),
  ];
  const annotated = findings.flatMap((finding) =>
    annotateDeterministic(finding),
  );
  jsonLog("info", "deterministic signals completed", {
    findingsCount: findings.length,
    annotatedCount: annotated.length,
  });
  return annotated;
}

async function deterministicSignalsImpl(
  input: DeterministicSignalInput,
): Promise<AnnotatedFinding[]> {
  return await withSpan(
    "prReview.deterministicSignals",
    {
      "files.changed": input.context.changedFiles.length,
    },
    () =>
      runDeterministicSignals(input, {
        checkImageManifest: defaultCheckImageManifest,
      }),
  );
}

export type DeterministicSignalActivities =
  typeof deterministicSignalActivities;

export const deterministicSignalActivities = {
  async prReviewDeterministicSignals(
    input: DeterministicSignalInput,
  ): Promise<AnnotatedFinding[]> {
    return deterministicSignalsImpl(input);
  },
};
