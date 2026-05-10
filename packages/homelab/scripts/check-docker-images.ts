#!/usr/bin/env bun
/**
 * Docker Image Digest Existence Checker
 *
 * Verifies that all Docker image digests in versions.ts actually exist
 * in their upstream registries. Uses the Docker Registry HTTP API v2.
 *
 * Usage: bun run scripts/check-docker-images.ts
 *
 * Exit codes:
 *   0 - All checks passed
 *   1 - One or more digests not found
 */

import path from "node:path";
import { z } from "zod";

const VERSIONS_PATH = path.join(
  import.meta.dir,
  "../src/cdk8s/src/versions.ts",
);

const MAX_CONCURRENCY = 5;
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

// Registry auth endpoints
const REGISTRY_AUTH: Record<
  string,
  { tokenUrl: string; service: string; apiBase: string }
> = {
  "docker.io": {
    tokenUrl: "https://auth.docker.io/token",
    service: "registry.docker.io",
    apiBase: "https://registry-1.docker.io",
  },
  "ghcr.io": {
    tokenUrl: "https://ghcr.io/token",
    service: "ghcr.io",
    apiBase: "https://ghcr.io",
  },
  "quay.io": {
    tokenUrl: "https://quay.io/v2/auth",
    service: "quay.io",
    apiBase: "https://quay.io",
  },
};

const VersionEntrySchema = z.object({
  key: z.string(),
  value: z.string(),
  registryUrl: z.string(),
  packageName: z.string().optional(),
  isManaged: z.boolean(),
});

type VersionEntry = z.infer<typeof VersionEntrySchema>;

type CheckResult = {
  key: string;
  status: "ok" | "fail" | "skip";
  message: string;
};

async function parseDockerEntriesAsync(): Promise<VersionEntry[]> {
  const content = await Bun.file(VERSIONS_PATH).text();
  const lines = content.split("\n");
  const entries: VersionEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;

    // Match key-value lines
    const kvMatchInline =
      /^\s*"?([^":\s]+(?:\/[^":\s]+)*)"?\s*:\s*"([^"]+)"/.exec(line);
    let key: string | undefined;
    let value: string | undefined;

    if (kvMatchInline) {
      key = kvMatchInline[1];
      value = kvMatchInline[2];
    } else {
      const kvMatch = /^\s*"?([^":\s]+(?:\/[^":\s]+)*)"?\s*:\s*$/.exec(line);
      if (kvMatch) {
        const nextLine = lines[i + 1];
        if (nextLine !== undefined) {
          const valueMatch = /^\s*"([^"]+)"/.exec(nextLine);
          if (valueMatch) {
            key = kvMatch[1];
            value = valueMatch[1];
          }
        }
      }
    }

    if (key === undefined || value === undefined) continue;
    if (!value.includes("@sha256:")) continue;

    // Look backwards for comment
    const commentLines: string[] = [];
    for (let j = i - 1; j >= 0; j--) {
      const commentLine = lines[j];
      if (commentLine !== undefined && commentLine.trim().startsWith("//")) {
        commentLines.unshift(commentLine.trim());
      } else {
        break;
      }
    }

    const rawComment = commentLines.join("\n");
    const isManaged = !rawComment.includes("not managed by renovate");

    // Extract registryUrl and packageName from comment
    const registryUrlMatch = /registryUrl=(\S+)/.exec(rawComment);
    const registryUrl = registryUrlMatch?.[1] ?? "";
    const packageNameMatch = /packageName=(\S+)/.exec(rawComment);
    const packageName = packageNameMatch?.[1];

    entries.push({ key, value, registryUrl, packageName, isManaged });
  }

  return entries;
}

function getRegistryInfo(
  registryUrl: string,
): { tokenUrl: string; service: string; apiBase: string } | undefined {
  // Normalize registry URL
  const normalized = registryUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");

  for (const [key, info] of Object.entries(REGISTRY_AUTH)) {
    if (normalized.includes(key)) {
      return info;
    }
  }

  // For ghcr.io sub-paths like ghcr.io/buildkite/helm or ghcr.io/recyclarr
  if (normalized.startsWith("ghcr.io")) {
    return REGISTRY_AUTH["ghcr.io"];
  }

  return undefined;
}

function parseImageRef(
  entry: VersionEntry,
): { registry: string; repository: string; digest: string } | undefined {
  const digestMatch = /@sha256:([a-f0-9]{64})$/.exec(entry.value);
  if (!digestMatch) return undefined;

  const digest = digestMatch[1];
  if (digest === undefined) return undefined;

  const registryInfo = getRegistryInfo(entry.registryUrl);
  if (!registryInfo) return undefined;

  // Determine the actual Docker repository name:
  // 1. If packageName is set, use it (e.g., "shepherdjerred/scout-for-lol")
  // 2. If registryUrl has a sub-path (e.g., "ghcr.io/recyclarr"), combine sub-path + key
  // 3. Otherwise, use the key directly
  let repository: string;

  if (entry.packageName) {
    repository = entry.packageName;
  } else {
    // Check if registryUrl has a sub-path beyond the base registry
    const normalized = entry.registryUrl
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "");

    // Find the base registry key
    let baseRegistry = "";
    for (const registryKey of Object.keys(REGISTRY_AUTH)) {
      if (normalized.startsWith(registryKey)) {
        baseRegistry = registryKey;
        break;
      }
    }

    if (baseRegistry && normalized.length > baseRegistry.length) {
      // There's a sub-path: e.g., "ghcr.io/recyclarr" -> sub-path is "recyclarr"
      const subPath = normalized.substring(baseRegistry.length + 1); // +1 for the /
      repository = `${subPath}/${entry.key}`;
    } else {
      repository = entry.key;
    }
  }

  return {
    registry: entry.registryUrl.replace(/^https?:\/\//, "").replace(/\/$/, ""),
    repository,
    digest,
  };
}

async function getAuthToken(
  registryInfo: { tokenUrl: string; service: string },
  repository: string,
): Promise<string | undefined> {
  const url = `${registryInfo.tokenUrl}?scope=repository:${repository}:pull&service=${registryInfo.service}`;

  const response = await fetch(url);
  if (!response.ok) return undefined;

  const body = (await response.json()) as { token?: string };
  return body.token;
}

async function checkDigestExists(entry: VersionEntry): Promise<CheckResult> {
  if (!entry.isManaged) {
    return {
      key: entry.key,
      status: "skip",
      message: "not managed by renovate",
    };
  }

  const imageRef = parseImageRef(entry);
  if (!imageRef) {
    return {
      key: entry.key,
      status: "skip",
      message: `unknown registry: ${entry.registryUrl}`,
    };
  }

  const registryInfo = getRegistryInfo(entry.registryUrl);
  if (!registryInfo) {
    return {
      key: entry.key,
      status: "skip",
      message: `no auth config for: ${entry.registryUrl}`,
    };
  }

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const token = await getAuthToken(registryInfo, imageRef.repository);
      if (!token) {
        return {
          key: entry.key,
          status: "fail",
          message: "failed to get auth token",
        };
      }

      const manifestUrl = `${registryInfo.apiBase}/v2/${imageRef.repository}/manifests/sha256:${imageRef.digest}`;
      const response = await fetch(manifestUrl, {
        method: "HEAD",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: [
            "application/vnd.docker.distribution.manifest.v2+json",
            "application/vnd.docker.distribution.manifest.list.v2+json",
            "application/vnd.oci.image.manifest.v1+json",
            "application/vnd.oci.image.index.v1+json",
          ].join(", "),
        },
      });

      if (response.ok) {
        return {
          key: entry.key,
          status: "ok",
          message: `sha256:${imageRef.digest.substring(0, 12)}...`,
        };
      }

      if (response.status === 429) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        console.warn(
          `  [RATE LIMITED] ${entry.key} — retrying in ${String(backoff)}ms`,
        );
        await Bun.sleep(backoff);
        continue;
      }

      return {
        key: entry.key,
        status: "fail",
        message: `HTTP ${String(response.status)}: ${response.statusText}`,
      };
    } catch (error) {
      if (attempt === MAX_RETRIES - 1) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          key: entry.key,
          status: "fail",
          message: `network error: ${msg}`,
        };
      }
      const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
      await Bun.sleep(backoff);
    }
  }

  return {
    key: entry.key,
    status: "fail",
    message: "max retries exceeded",
  };
}

async function main() {
  const entries = await parseDockerEntriesAsync();
  console.log(`Checking ${String(entries.length)} Docker image digests...\n`);

  const results: CheckResult[] = [];

  // Process in batches for concurrency control
  for (let i = 0; i < entries.length; i += MAX_CONCURRENCY) {
    const batch = entries.slice(i, i + MAX_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((entry) => checkDigestExists(entry)),
    );
    results.push(...batchResults);
  }

  // Print results
  const ok = results.filter((r) => r.status === "ok");
  const fail = results.filter((r) => r.status === "fail");
  const skip = results.filter((r) => r.status === "skip");

  for (const r of results) {
    const icon =
      r.status === "ok" ? "[OK]  " : r.status === "fail" ? "[FAIL]" : "[SKIP]";
    console.log(`${icon} ${r.key} — ${r.message}`);
  }

  console.log(
    `\nResults: ${String(ok.length)} OK, ${String(fail.length)} FAIL, ${String(skip.length)} SKIP`,
  );

  if (fail.length > 0) {
    process.exit(1);
  }
}

await main();
