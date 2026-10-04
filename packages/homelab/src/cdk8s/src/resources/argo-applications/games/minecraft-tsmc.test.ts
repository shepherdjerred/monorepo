import { describe, expect, test } from "vitest";
import { App, Chart, Testing } from "cdk8s";
import { z } from "zod";
import { parse as parseYaml } from "yaml";
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
const OpItemSchema = z
  .object({
    kind: z.literal("OnePasswordItem"),
    metadata: z.object({ name: z.string() }).loose(),
    spec: z.object({ itemPath: z.string() }).loose(),
  })
  .loose();

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

function synthTsmc(): unknown[] {
  const app = new App();
  const chart = new Chart(app, "test", { disableResourceNameHashes: true });
  createMinecraftTsmcApp(chart);
  return Testing.synth(chart);
}

describe("minecraft-tsmc runs The Storm's image", () => {
  test("projects the brain bearer token into the game namespace", () => {
    const manifests = synthTsmc();
    const item = manifests
      .map((manifest) => OpItemSchema.safeParse(manifest))
      .find(
        (result) =>
          result.success &&
          result.data.metadata.name === "minecraft-tsmc-storm-brain",
      )?.data;
    expect(item?.spec.itemPath).toMatch(/\/items\/storm-brain$/u);

    const values = tsmcValues();
    const extraEnv = z
      .record(z.string(), z.unknown())
      .parse(values["extraEnv"]);
    expect(extraEnv["STORM_BRAIN_BEARER_TOKEN"]).toEqual({
      valueFrom: {
        secretKeyRef: {
          name: "minecraft-tsmc-storm-brain",
          key: "STORM_BRAIN_BEARER_TOKEN",
        },
      },
    });
  });

  test("pins the image by the accepted production digest", () => {
    const values = tsmcValues();
    expect(values["image"]).toEqual({
      repository: "ghcr.io/shepherdjerred/the-storm-server",
      tag: versions["shepherdjerred/the-storm-server/prod"],
    });
    expect(versions["shepherdjerred/the-storm-server/prod"]).toMatch(
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

  test("exposes Bedrock UDP on its own NodePort", () => {
    const server = z
      .record(z.string(), z.unknown())
      .parse(tsmcValues()["minecraftServer"]);
    const ports = z
      .array(z.record(z.string(), z.unknown()))
      .parse(server["extraPorts"]);
    expect(ports).toContainEqual({
      service: {
        enabled: true,
        type: "NodePort",
        port: 19_132,
        nodePort: 30_004,
      },
      protocol: "UDP",
      containerPort: 19_132,
      name: "bedrock",
      ingress: { enabled: false },
    });
  });

  test("bakes the verified Geyser and Floodgate builds", async () => {
    const manifest = z
      .object({
        plugins: z.array(
          z.object({
            name: z.string(),
            version: z.string(),
            url: z.url(),
            sha256: z.string(),
            file: z.string(),
          }),
        ),
      })
      .parse(await Bun.file(`${serverDir}/plugins.json`).json());
    expect(
      manifest.plugins.filter(
        ({ name }) => name === "Geyser-Spigot" || name === "floodgate",
      ),
    ).toEqual([
      {
        name: "floodgate",
        version: "2.2.5 build 141",
        url: "https://download.geysermc.org/v2/projects/floodgate/versions/2.2.5/builds/141/downloads/spigot",
        sha256:
          "21570aff9ce17d6983928e8552777760e1ede5050026b04c686b0ae112e6fd7e",
        file: "Floodgate-2.2.5-b141.jar",
      },
      {
        name: "Geyser-Spigot",
        version: "2.11.3 build 1247",
        url: "https://download.geysermc.org/v2/projects/geyser/versions/2.11.3/builds/1247/downloads/spigot",
        sha256:
          "6fed2d9711e2db3c365508ec10db36d06a0199abd226159d23d57f82662fd7a6",
        file: "Geyser-Spigot-2.11.3-b1247.jar",
      },
    ]);
  });

  test("provides the Bedrock listener and Floodgate auth before the first boot", async () => {
    const geyser = z
      .object({
        bedrock: z.object({
          address: z.string(),
          port: z.number(),
          "clone-remote-port": z.boolean(),
        }),
        java: z.object({ "auth-type": z.string() }),
        advanced: z.object({
          bedrock: z.object({ "broadcast-port": z.number() }),
        }),
      })
      .parse(
        parseYaml(
          await Bun.file(
            `${serverDir}/owned/plugins/Geyser-Spigot/config.yml`,
          ).text(),
        ),
      );
    expect(geyser.bedrock).toMatchObject({
      address: "0.0.0.0",
      port: 19_132,
      "clone-remote-port": false,
    });
    expect(geyser.java["auth-type"]).toBe("floodgate");
    expect(geyser.advanced.bedrock["broadcast-port"]).toBe(30_004);
    expect(await dockerfile()).toContain(
      "COPY server/owned/plugins/ /plugins/",
    );
  });

  test("turns vanilla spawn protection off", () => {
    // The towns module protects spawn with admin regions; vanilla spawn
    // protection would stop non-ops using the windmill Storm Shards altar.
    const server = z
      .record(z.string(), z.unknown())
      .parse(tsmcValues()["minecraftServer"]);
    expect(server["spawnProtection"]).toBe(0);
  });

  test("retires PVC-only jars alongside the enabled towns protection", async () => {
    const text = await dockerfile();
    expect(text).toMatch(/^\s*REMOVE_OLD_MODS_EXCLUDE=$/mu);
    const config = z
      .object({ modules: z.object({ towns: z.literal(true) }) })
      .parse(
        parseYaml(
          await Bun.file(
            `${serverDir}/owned/plugins/TheStorm/config.yml`,
          ).text(),
        ),
      );
    expect(config.modules.towns).toBe(true);
    expect(tsmcValues()["minecraftServer"]).toMatchObject({
      removeOldMods: true,
    });
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

describe("minecraft-tsmc MCBridge", () => {
  test("wires MCBridge to the storm-brain token on a port-forward-only port", () => {
    const values = tsmcValues();
    const extraEnv = z
      .record(z.string(), z.unknown())
      .parse(values["extraEnv"]);
    expect(extraEnv["MC_BRIDGE_TOKEN"]).toEqual({
      valueFrom: {
        secretKeyRef: {
          name: "minecraft-tsmc-storm-brain",
          key: "MC_BRIDGE_TOKEN",
        },
      },
    });
    expect(extraEnv["MC_BRIDGE_BIND"]).toBe("0.0.0.0");
    const server = z
      .record(z.string(), z.unknown())
      .parse(values["minecraftServer"]);
    const ports = z
      .array(z.record(z.string(), z.unknown()))
      .parse(server["extraPorts"]);
    expect(ports).toContainEqual({
      service: { enabled: false, port: 25_580 },
      protocol: "TCP",
      containerPort: 25_580,
      name: "bridge",
      ingress: { enabled: false },
    });
  });
});

describe("minecraft-tsmc Search and Destroy recordings", () => {
  test("projects the rwf recording salt from its own item", () => {
    const manifests = synthTsmc();
    const items = manifests
      .map((manifest) => OpItemSchema.safeParse(manifest))
      .flatMap((result) => (result.success ? [result.data] : []));
    const item = items.find(
      ({ metadata }) => metadata.name === "minecraft-tsmc-rwf-recording",
    );
    expect(item?.spec.itemPath).toMatch(/\/items\/the-storm-rwf-recording$/u);
    expect(
      items.filter(({ spec }) =>
        spec.itemPath.endsWith("/items/the-storm-rwf-recording"),
      ),
    ).toHaveLength(1);

    const extraEnv = z
      .record(z.string(), z.unknown())
      .parse(tsmcValues()["extraEnv"]);
    expect(extraEnv["RWF_RECORDING_SALT"]).toEqual({
      valueFrom: {
        secretKeyRef: {
          name: "minecraft-tsmc-rwf-recording",
          key: "RWF_RECORDING_SALT",
        },
      },
    });
  });
});
