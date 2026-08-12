import { describe, expect, it } from "bun:test";
import rawCatalog from "@shepherdjerred/version-catalog/catalog.json";
import { parseVersionCatalog } from "@shepherdjerred/version-catalog";
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
  "custom.papermc",
]);
const VERSIONING = new Set([
  "semver",
  "semver-coerced",
  "docker",
  "loose",
  "npm",
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
      expect(DATASOURCES.has(entry.management.datasource)).toBeTrue();
      expect(VERSIONING.has(entry.management.versioning)).toBeTrue();
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
      expect(SEMVER_PATTERN.test(entry.value)).toBeTrue();
    }
  });

  it("uses canonical image digests", () => {
    for (const entry of catalog.entries) {
      if (entry.artifactType !== "image") continue;
      expect(DOCKER_REF_PATTERN.test(entry.value)).toBeTrue();
      const digest = entry.value.split("@sha256:")[1];
      expect(digest).toBeDefined();
      expect(SHA256_PATTERN.test(digest ?? "")).toBeTrue();
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
