import { describe, it, expect } from "bun:test";
import versions from "./versions.ts";
import { z } from "zod";
import path from "node:path";

/**
 * Static Validation Tests for versions.ts
 *
 * Fast, pure-TypeScript checks that validate version format,
 * Renovate comment integrity, and digest format. No network access.
 */

const VERSIONS_PATH = path.join(import.meta.dir, "versions.ts");

// --- Schemas ---

const DatasourceSchema = z.enum([
  "helm",
  "docker",
  "github-releases",
  "custom.papermc",
]);

const VersioningSchema = z.enum([
  "semver",
  "semver-coerced",
  "docker",
  "loose",
]);

const RenovateCommentSchema = z.object({
  datasource: DatasourceSchema,
  registryUrl: z.string().optional(),
  versioning: VersioningSchema,
  packageName: z.string().optional(),
});

type RenovateComment = z.infer<typeof RenovateCommentSchema>;

type VersionEntry = {
  key: string;
  value: string;
  comment: RenovateComment | "not-managed";
  rawComment: string;
};

// --- Patterns ---

// Semver with optional v prefix and optional prerelease
const SEMVER_PATTERN = /^v?\d+\.\d+\.\d+(?:-[\w.]+)?$/;

// Docker image reference: TAG@sha256:HEX{64}
const DOCKER_REF_PATTERN = /^[^@]+@sha256:[a-f0-9]{64}$/;

// SHA256 digest: exactly 64 hex chars
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

// --- Parser ---

function parseRenovateComment(
  rawComment: string,
): RenovateComment | "not-managed" {
  if (rawComment.includes("not managed by renovate")) {
    return "not-managed";
  }

  const datasourceMatch = /datasource=(\S+)/.exec(rawComment);
  const registryUrlMatch = /registryUrl=(\S+)/.exec(rawComment);
  const versioningMatch = /versioning=(\S+)/.exec(rawComment);
  const packageNameMatch = /packageName=(\S+)/.exec(rawComment);

  return RenovateCommentSchema.parse({
    datasource: datasourceMatch?.[1],
    registryUrl: registryUrlMatch?.[1],
    versioning: versioningMatch?.[1],
    packageName: packageNameMatch?.[1],
  });
}

async function parseVersionEntries(): Promise<VersionEntry[]> {
  const content = await Bun.file(VERSIONS_PATH).text();
  const lines = content.split("\n");
  const entries: VersionEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;

    // Match a key-value line like: "key": "value", or key: "value",
    // Key pattern: either a quoted string or bare identifier with slashes
    const kvMatch =
      /^\s*"([^"]+)"\s*:\s*$/.exec(line) ?? /^\s*(\w[\w-]*)\s*:\s*$/.exec(line);
    const kvMatchInline =
      /^\s*"([^"]+)"\s*:\s*"([^"]+)"/.exec(line) ??
      /^\s*(\w[\w-]*)\s*:\s*"([^"]+)"/.exec(line);

    let key: string | undefined;
    let value: string | undefined;

    if (kvMatchInline) {
      key = kvMatchInline[1];
      value = kvMatchInline[2];
    } else if (kvMatch) {
      // Value is on the next line
      const nextLine = lines[i + 1];
      if (nextLine !== undefined) {
        const valueMatch = /^\s*"([^"]+)"/.exec(nextLine);
        if (valueMatch) {
          key = kvMatch[1];
          value = valueMatch[1];
        }
      }
    }

    if (key === undefined || value === undefined) continue;

    // Look backwards for comment block
    const commentLines: string[] = [];
    for (let j = i - 1; j >= 0; j--) {
      const commentLine = lines[j];
      if (commentLine?.trim().startsWith("//")) {
        commentLines.unshift(commentLine.trim());
      } else {
        break;
      }
    }

    const rawComment = commentLines.join("\n");
    if (rawComment === "") continue;

    const comment = parseRenovateComment(rawComment);

    entries.push({ key, value, comment, rawComment });
  }

  return entries;
}

// --- Tests ---

describe("versions.ts - Static Validation", () => {
  let entries: VersionEntry[];

  // Use a promise to parse once and share across tests
  const entriesPromise = parseVersionEntries();

  describe("Version String Format", () => {
    it("helm chart versions are valid semver", async () => {
      entries = await entriesPromise;
      const violations: { key: string; value: string }[] = [];

      for (const entry of entries) {
        if (entry.comment === "not-managed") continue;
        if (entry.comment.datasource !== "helm") continue;

        if (!SEMVER_PATTERN.test(entry.value)) {
          violations.push({ key: entry.key, value: entry.value });
        }
      }

      if (violations.length > 0) {
        const msg = violations
          .map((v) => `  ${v.key}: "${v.value}" is not valid semver`)
          .join("\n");
        throw new Error(`Invalid helm chart versions:\n${msg}`);
      }
    });

    it("docker image references have valid tag@sha256:hex64 format", async () => {
      entries = await entriesPromise;
      const violations: { key: string; value: string }[] = [];

      for (const entry of entries) {
        if (entry.comment === "not-managed") {
          // Not-managed entries with @ should still have valid digest format
          if (
            entry.value.includes("@sha256:") &&
            !DOCKER_REF_PATTERN.test(entry.value)
          ) {
            violations.push({ key: entry.key, value: entry.value });
          }
          continue;
        }
        if (entry.comment.datasource !== "docker") continue;

        // Some docker entries are actually OCI helm charts (no digest)
        if (!entry.value.includes("@sha256:")) {
          // Should be valid semver instead
          if (!SEMVER_PATTERN.test(entry.value)) {
            violations.push({ key: entry.key, value: entry.value });
          }
          continue;
        }

        if (!DOCKER_REF_PATTERN.test(entry.value)) {
          violations.push({ key: entry.key, value: entry.value });
        }
      }

      if (violations.length > 0) {
        const msg = violations
          .map(
            (v) => `  ${v.key}: "${v.value}" is not a valid docker reference`,
          )
          .join("\n");
        throw new Error(`Invalid docker image references:\n${msg}`);
      }
    });

    it("github-releases entries are valid semver", async () => {
      entries = await entriesPromise;
      const violations: { key: string; value: string }[] = [];

      for (const entry of entries) {
        if (entry.comment === "not-managed") continue;
        if (entry.comment.datasource !== "github-releases") continue;

        if (!SEMVER_PATTERN.test(entry.value)) {
          violations.push({ key: entry.key, value: entry.value });
        }
      }

      if (violations.length > 0) {
        const msg = violations
          .map((v) => `  ${v.key}: "${v.value}" is not valid semver`)
          .join("\n");
        throw new Error(`Invalid github-releases versions:\n${msg}`);
      }
    });
  });

  describe("SHA256 Digest Format", () => {
    it("all sha256 digests are exactly 64 hex characters", async () => {
      entries = await entriesPromise;
      const violations: { key: string; digest: string }[] = [];

      for (const entry of entries) {
        const digestMatch = /@sha256:([a-f0-9]+)/.exec(entry.value);
        if (!digestMatch) continue;

        const digest = digestMatch[1];
        if (digest === undefined || !SHA256_PATTERN.test(digest)) {
          violations.push({ key: entry.key, digest: digest ?? "undefined" });
        }
      }

      if (violations.length > 0) {
        const msg = violations
          .map((v) => `  ${v.key}: digest "${v.digest}" is not 64 hex chars`)
          .join("\n");
        throw new Error(`Invalid SHA256 digests:\n${msg}`);
      }
    });
  });

  describe("Renovate Comment Integrity", () => {
    it("every entry has a renovate comment or not-managed marker", async () => {
      entries = await entriesPromise;
      const violations: string[] = [];

      for (const entry of entries) {
        if (
          entry.rawComment === "" ||
          (!entry.rawComment.includes("renovate:") &&
            !entry.rawComment.includes("not managed by renovate"))
        ) {
          violations.push(entry.key);
        }
      }

      if (violations.length > 0) {
        throw new Error(
          `Entries without renovate comment or not-managed marker:\n  ${violations.join("\n  ")}`,
        );
      }
    });

    it("helm datasource entries have a registryUrl", async () => {
      entries = await entriesPromise;
      const violations: string[] = [];

      for (const entry of entries) {
        if (entry.comment === "not-managed") continue;
        if (entry.comment.datasource !== "helm") continue;

        if (!entry.comment.registryUrl) {
          violations.push(entry.key);
        }
      }

      if (violations.length > 0) {
        throw new Error(
          `Helm entries without registryUrl:\n  ${violations.join("\n  ")}`,
        );
      }
    });

    it("docker datasource entries have a registryUrl", async () => {
      entries = await entriesPromise;
      const violations: string[] = [];

      for (const entry of entries) {
        if (entry.comment === "not-managed") continue;
        if (entry.comment.datasource !== "docker") continue;

        if (!entry.comment.registryUrl) {
          violations.push(entry.key);
        }
      }

      if (violations.length > 0) {
        throw new Error(
          `Docker entries without registryUrl:\n  ${violations.join("\n  ")}`,
        );
      }
    });

    it("renovate comments have valid datasource and versioning fields", async () => {
      entries = await entriesPromise;
      // If parsing succeeded without throwing, all comments are valid.
      // This test documents the expectation.
      const renovateEntries = entries.filter(
        (e) => e.comment !== "not-managed",
      );
      expect(renovateEntries.length).toBeGreaterThan(0);
    });
  });

  describe("Key Coverage", () => {
    it("versions object has entries matching the parsed count", async () => {
      entries = await entriesPromise;
      const versionKeys = Object.keys(versions);
      expect(versionKeys.length).toBe(entries.length);
    });

    it("every parsed key exists in the versions object", async () => {
      entries = await entriesPromise;
      const versionKeys = new Set(Object.keys(versions));
      const missing = entries.filter((e) => !versionKeys.has(e.key));

      if (missing.length > 0) {
        throw new Error(
          `Parsed keys not found in versions object:\n  ${missing.map((e) => e.key).join("\n  ")}`,
        );
      }
    });
  });
});
