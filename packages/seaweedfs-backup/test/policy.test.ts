import { describe, expect, test } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import rawPolicy from "#policy" with { type: "json" };
import policySchema from "#policy-schema" with { type: "json" };
import {
  SEAWEEDFS_BACKUP_POLICY,
  evaluateCoverage,
  objectIsProtected,
} from "@shepherdjerred/seaweedfs-backup/policy";
import {
  BackupEnvironmentSchema,
  BackupPolicySchema,
} from "@shepherdjerred/seaweedfs-backup/schemas";

describe("SeaweedFS backup policy", () => {
  test("conforms to the published language-neutral JSON Schema", () => {
    const validate = new Ajv2020({
      strict: true,
      validateFormats: false,
    }).compile(policySchema);
    expect(validate(rawPolicy)).toBe(true);
    expect(validate.errors).toBeNull();
  });

  test("classifies every bucket declared by the SeaweedFS Tofu stack", async () => {
    const bucketsFile = await Bun.file(
      new URL("../../homelab/src/tofu/seaweedfs/buckets.tf", import.meta.url),
    ).text();
    const declared = [...bucketsFile.matchAll(/^\s*bucket\s*=\s*"([^"]+)"/gm)]
      .map((match) => match[1])
      .filter((name) => name !== undefined);
    const coverage = evaluateCoverage(declared, SEAWEEDFS_BACKUP_POLICY);
    expect(coverage.unclassified).toEqual([]);
  });

  test("declares the WNAM Standard R2 bucket, locks, and multipart expiry", async () => {
    const cloudflareResources = await Bun.file(
      new URL(
        "../../homelab/src/tofu/cloudflare/glitter-discord-corpus.tf",
        import.meta.url,
      ),
    ).text();
    const providers = await Bun.file(
      new URL(
        "../../homelab/src/tofu/cloudflare/providers.tf",
        import.meta.url,
      ),
    ).text();
    expect(cloudflareResources).toContain(
      'resource "cloudflare_r2_bucket" "seaweedfs_backups"',
    );
    expect(cloudflareResources).toContain('location      = "WNAM"');
    expect(cloudflareResources).toContain('storage_class = "Standard"');
    expect(cloudflareResources).toContain('prefix  = "objects/"');
    expect(cloudflareResources).toContain('prefix  = "snapshots/"');
    expect(cloudflareResources).toContain("max_age_seconds = 2592000");
    expect(cloudflareResources).toContain("max_age = 604800");
    expect(cloudflareResources).not.toContain("InfrequentAccess");
    expect(providers).toContain('version = "~> 5.24.0"');
  });

  test("requires explicit reasons and unique bucket names", () => {
    expect(
      SEAWEEDFS_BACKUP_POLICY.buckets.every(
        (bucket) => bucket.reason.length > 0,
      ),
    ).toBe(true);
    expect(
      new Set(SEAWEEDFS_BACKUP_POLICY.buckets.map((bucket) => bucket.name))
        .size,
    ).toBe(SEAWEEDFS_BACKUP_POLICY.buckets.length);
  });

  test("accepts an ordinary process environment with unrelated variables", () => {
    expect(
      BackupEnvironmentSchema.parse({
        SEAWEEDFS_BACKUP_SOURCE_ENDPOINT: "http://seaweedfs.test",
        SEAWEEDFS_BACKUP_SOURCE_ACCESS_KEY_ID: "source-key",
        SEAWEEDFS_BACKUP_SOURCE_SECRET_ACCESS_KEY: "source-secret",
        R2_BACKUP_ENDPOINT: "https://account.r2.cloudflarestorage.com",
        R2_BACKUP_ACCESS_KEY_ID: "r2-key",
        R2_BACKUP_SECRET_ACCESS_KEY: "r2-secret",
        R2_BACKUP_BUCKET: "seaweedfs-backups",
        PATH: "/usr/bin",
      }),
    ).not.toHaveProperty("PATH");
  });

  test("rejects a protected bucket without a cadence", () => {
    expect(() =>
      BackupPolicySchema.parse({
        ...SEAWEEDFS_BACKUP_POLICY,
        buckets: [
          {
            name: "broken",
            mode: "protected",
            cadences: [],
            excludeSuffixes: [],
            reason: "fixture",
          },
        ],
      }),
    ).toThrow();
  });

  test("excludes Scout images case-insensitively and keeps Unicode keys", () => {
    const scout = SEAWEEDFS_BACKUP_POLICY.buckets.find(
      (bucket) => bucket.name === "scout-prod",
    );
    if (scout === undefined) throw new Error("Missing scout-prod policy");
    expect(objectIsProtected("games/naïve résumé.JSON", scout)).toBe(true);
    expect(objectIsProtected("games/render.PNG", scout)).toBe(false);
    expect(objectIsProtected("prematch/vector.SvG", scout)).toBe(false);
  });
});
