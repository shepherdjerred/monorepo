import { describe, expect, test } from "vitest";
import { Testing } from "cdk8s";
import { z } from "zod";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import {
  THE_STORM_PAPER_VERSION,
  createMinecraftTsmcApp,
} from "./minecraft-tsmc.ts";

// minecraft-tsmc runs ghcr.io/shepherdjerred/the-storm-server, built from
// packages/the-storm/server. These tests keep the chart values and that image
// consistent: the chart's VERSION env overrides the image's, and the image's
// itzg base must be the same pin the catalog tracks.

// Repo root: this file lives at packages/homelab/src/cdk8s/src/resources/argo-applications/games/.
const repoRoot = new URL("../../../../../../../../", import.meta.url).pathname;
const serverDir = `${repoRoot}packages/the-storm/server`;

const ManifestSchema = z.object({
  paper: z.object({ version: z.string(), file: z.string() }),
});

const HelmValues = z.record(z.string(), z.unknown());
const HelmSource = z.object({ helm: z.object({ valuesObject: HelmValues }) });

async function dockerfile(): Promise<string> {
  return Bun.file(`${serverDir}/Dockerfile`).text();
}

function envValue(text: string, name: string): string {
  const match = new RegExp(String.raw`\b${name}=(\S+)`).exec(text);
  if (match?.[1] === undefined) {
    throw new Error(`Dockerfile does not set ${name}`);
  }
  return match[1];
}

function tsmcValues(): Record<string, unknown> {
  const application = createMinecraftTsmcApp(Testing.chart()).toJson();
  return z.object({ spec: z.object({ source: HelmSource }) }).parse(application)
    .spec.source.helm.valuesObject;
}

describe("minecraft-tsmc runs The Storm's image", () => {
  test("pins the image by the catalog's the-storm-server digest", () => {
    const values = tsmcValues();
    expect(values["image"]).toEqual({
      repository: "ghcr.io/shepherdjerred/the-storm-server",
      tag: versions["shepherdjerred/the-storm-server"],
    });
    expect(versions["shepherdjerred/the-storm-server"]).toMatch(
      /@sha256:[a-f\d]{64}$/,
    );
  });

  test("leaves plugins and config delivery to the image", () => {
    const values = tsmcValues();
    const server = z
      .record(z.string(), z.unknown())
      .parse(values["minecraftServer"]);
    expect(server["pluginUrls"]).toBeUndefined();
    expect(values["initContainers"]).toBeUndefined();
    expect(values["extraVolumes"]).toBeUndefined();
    expect(values["extraDeploy"]).toBeUndefined();
    expect(server["type"]).toBe("PAPER");
    expect(server["version"]).toBe(THE_STORM_PAPER_VERSION);
  });

  test("turns vanilla spawn protection off", () => {
    // The towns module protects spawn with admin regions; vanilla spawn
    // protection would stop non-ops using the windmill Storm Shards altar.
    const server = z
      .record(z.string(), z.unknown())
      .parse(tsmcValues()["minecraftServer"]);
    expect(server["spawnProtection"]).toBe(0);
  });

  test("builds the image on the catalog's itzg/minecraft-server pin", async () => {
    const text = await dockerfile();
    const bases = [
      ...text.matchAll(/^FROM itzg\/minecraft-server:(\S+)/gmu),
    ].map((match) => match[1]);
    expect(bases.length).toBeGreaterThan(0);
    for (const base of bases) {
      expect(base).toBe(versions["itzg/minecraft-server"]);
    }
  });

  test("builds TheStorm.jar with .mise.toml's Gradle and Java major", async () => {
    const mise = await Bun.file(`${repoRoot}.mise.toml`).text();
    const gradle = /^gradle = "([^"]+)"$/mu.exec(mise)?.[1];
    const javaMajor = /^java = "corretto-(\d+)\./mu.exec(mise)?.[1];
    expect(gradle).toBeDefined();
    expect(javaMajor).toBeDefined();
    expect(await dockerfile()).toMatch(
      new RegExp(
        String.raw`^FROM gradle:${String(gradle).replaceAll(".", String.raw`\.`)}-jdk${String(javaMajor)}-corretto@sha256:[a-f\d]{64} AS plugin$`,
        "mu",
      ),
    );
  });

  test("sets VERSION and the Paper jar the chart and manifest agree on", async () => {
    const text = await dockerfile();
    const manifest = ManifestSchema.parse(
      await Bun.file(`${serverDir}/plugins.json`).json(),
    );
    expect(envValue(text, "VERSION")).toBe(THE_STORM_PAPER_VERSION);
    expect(
      manifest.paper.version.startsWith(`${THE_STORM_PAPER_VERSION}-`),
    ).toBe(true);
    expect(envValue(text, "PAPER_CUSTOM_JAR")).toBe(
      `/opt/paper/${manifest.paper.file}`,
    );
  });
});
