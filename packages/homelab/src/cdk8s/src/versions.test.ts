import { describe, expect, it } from "vitest";
import rawCatalog from "@shepherdjerred/version-catalog/catalog.json";
import { parseVersionCatalog } from "@shepherdjerred/version-catalog";
import { VersionMapSchema } from "./version-map.generated.ts";
import versions, {
  firstPartyImageRecipe,
  requireFirstPartyImage,
} from "./versions.ts";

const SEMVER_PATTERN = /^v?\d+\.\d+\.\d+(?:-[\w.]+)?$/;
const COERCED_SEMVER_PATTERN = /^v?\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?$/;
const DOCKER_REF_PATTERN = /^[^@]+@sha256:[a-f0-9]{64}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const DATASOURCES = new Set([
  "helm",
  "docker",
  "github-releases",
  "npm",
  "pypi",
  "custom.mc2discord-forge-1-12-2",
  "custom.papermc",
]);
const VERSIONING = new Set([
  "semver",
  "semver-coerced",
  "docker",
  "loose",
  "npm",
  "pep440",
  "regex:^https://cdn[.]modrinth[.]com/data/Cfbcv7uF/versions/[A-Za-z0-9]+/mc2discord-forge-1[.]12[.]2-(?<major>[0-9]+)[.](?<minor>[0-9]+)[.](?<patch>[0-9]+)[.]jar$",
  "regex:^version-(?<major>[0-9]+)[.](?<minor>[0-9]+)[.](?<patch>[0-9]+)-nonroot$",
  // tonistiigi/binfmt tags are `qemu-vX.Y.Z`, beside moving tags like `latest`.
  "regex:^qemu-v(?<major>[0-9]+)[.](?<minor>[0-9]+)[.](?<patch>[0-9]+)$",
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
      const pattern =
        entry.management.versioning === "semver-coerced"
          ? COERCED_SEMVER_PATTERN
          : SEMVER_PATTERN;
      expect(pattern.test(entry.value)).toBe(true);
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

const digest = (fill: string) => `sha256:${fill.repeat(64)}`;

describe("requireFirstPartyImage", () => {
  it("accepts the recipe and a published digest of the same repository", () => {
    const pinned = `docker.io/shepherdjerred/tracker@${digest("a")}`;
    expect(requireFirstPartyImage("tracker", pinned)).toBe(pinned);
    const recipe = firstPartyImageRecipe("tracker");
    expect(requireFirstPartyImage("tracker", recipe)).toBe(recipe);
  });

  it.each([
    "docker.io/shepherdjerred/tracker:latest",
    `docker.io/shepherdjerred/tracker@${digest("0")}`,
    `docker.io/shepherdjerred/media@${digest("a")}`,
    `docker.io/shepherdjerred/tracker:1.0.0@${digest("a")}`,
    `tracker@${digest("a")}`,
    `docker.io/shepherdjerred/tracker@sha256:${"A".repeat(64)}`,
  ])("rejects %s", (image) => {
    expect(() => requireFirstPartyImage("tracker", image)).toThrow(
      "immutable image digest",
    );
  });
});
