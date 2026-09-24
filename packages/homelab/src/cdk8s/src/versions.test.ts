import { describe, expect, it } from "vitest";
import rawCatalog from "@shepherdjerred/version-catalog/catalog.json";
import { parseVersionCatalog } from "@shepherdjerred/version-catalog";
import {
  catalogScoutPostgresImageDigests,
  scoutImageUsesPostgres,
} from "./release-configuration.ts";
import { VersionMapSchema } from "./version-map.generated.ts";
import versions from "./versions.ts";

const SEMVER_PATTERN = /^v?\d+\.\d+\.\d+(?:-[\w.]+)?$/;
const DOCKER_REF_PATTERN = /^[^@]+@sha256:[a-f0-9]{64}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const DATASOURCES = new Set([
  "helm",
  "docker",
  "github-releases",
  "npm",
  "custom.mc2discord-forge-1-12-2",
  "custom.papermc",
]);
const VERSIONING = new Set([
  "semver",
  "semver-coerced",
  "docker",
  "loose",
  "npm",
  "regex:^https://cdn[.]modrinth[.]com/data/Cfbcv7uF/versions/[A-Za-z0-9]+/mc2discord-forge-1[.]12[.]2-(?<major>[0-9]+)[.](?<minor>[0-9]+)[.](?<patch>[0-9]+)[.]jar$",
]);

const catalog = parseVersionCatalog(rawCatalog);

describe("version catalog static validation", () => {
  it("keeps the generated compatibility keys synchronized", () => {
    expect(Object.keys(VersionMapSchema.shape)).toEqual(
      catalog.entries.map((entry) => entry.name),
    );
  });

  it("has one compatibility-wrapper value per catalog entry", () => {
    expect(Object.keys(versions).length).toBe(catalog.entries.length);
    for (const entry of catalog.entries) {
      expect(versions[entry.name]).toBe(entry.value);
    }
  });

  it("uses valid managed metadata", () => {
    for (const entry of catalog.entries) {
      if (!entry.management.managed) continue;
      expect(DATASOURCES.has(entry.management.datasource)).toBe(true);
      expect(VERSIONING.has(entry.management.versioning)).toBe(true);
      if (
        entry.management.datasource === "helm" ||
        entry.management.datasource === "docker"
      ) {
        expect(entry.management.registryUrl).toBeDefined();
      }
    }
  });

  it("uses semver-shaped Helm and GitHub release values", () => {
    for (const entry of catalog.entries) {
      if (!entry.management.managed) continue;
      if (
        entry.management.datasource !== "helm" &&
        entry.management.datasource !== "github-releases"
      ) {
        continue;
      }
      expect(SEMVER_PATTERN.test(entry.value)).toBe(true);
    }
  });

  it("uses canonical image digests", () => {
    for (const entry of catalog.entries) {
      if (entry.artifactType !== "image") continue;
      expect(DOCKER_REF_PATTERN.test(entry.value)).toBe(true);
      const digest = entry.value.split("@sha256:")[1];
      expect(digest).toBeDefined();
      expect(SHA256_PATTERN.test(digest ?? "")).toBe(true);
    }
  });

  it("marks every deployed scout backend image with postgres provenance", () => {
    // The chart renders DATABASE_URL through scoutImageUsesPostgres: a pin
    // whose digest carries no "database contract: postgresql" marker gets the
    // SQLite URL, and every post-migration image crash-loops on it (Prisma
    // P1013) — exactly how the unmarked 2.0.0-16677 prod promotion took
    // scout-prod down in build 16982. Tags mint per build but markers land
    // via commit-back, so a promotion can offer an image that never earned
    // its note; this gates the promotion at verify time using the chart's
    // own predicate, so gate and chart cannot disagree.
    const markers = catalogScoutPostgresImageDigests(catalog);
    for (const stage of ["beta", "prod"] as const) {
      const pin = versions[`shepherdjerred/scout-for-lol/${stage}`];
      expect(scoutImageUsesPostgres(pin, markers)).toBe(true);
    }
  });

  it("describes OCI Helm chart package names explicitly", () => {
    for (const entry of catalog.entries) {
      if (
        entry.artifactType !== "helm-chart" ||
        !entry.management.managed ||
        entry.management.datasource !== "docker"
      ) {
        continue;
      }
      expect(entry.management.packageName).toBeDefined();
    }
  });
});
