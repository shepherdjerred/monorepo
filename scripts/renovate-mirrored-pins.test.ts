import { expect, test } from "vitest";
import { z } from "zod";
import { parseVersionCatalog } from "@shepherdjerred/version-catalog";
import { managerCoversFile } from "./checks/deps/check-renovate-hints.ts";
import {
  groupNameFor,
  loadRenovateConfig,
  matchesName,
  root,
} from "./checks/deps/renovate-config.ts";

// The slice of each custom manager the Minecraft and catalog-mirror tests
// read: its templates decide the datasource, registry and versioning.
const TemplatedManagerSchema = z.object({
  description: z.string(),
  managerFilePatterns: z.array(z.string()),
  matchStrings: z.array(z.string()),
  datasourceTemplate: z.string().optional(),
  depNameTemplate: z.string().optional(),
  registryUrlTemplate: z.string().optional(),
  versioningTemplate: z.string().optional(),
  extractVersionTemplate: z.string().optional(),
});
type TemplatedManager = z.infer<typeof TemplatedManagerSchema>;

async function loadTemplatedManagers(): Promise<TemplatedManager[]> {
  return z
    .object({ customManagers: z.array(TemplatedManagerSchema) })
    .parse(await Bun.file(`${root}/renovate.json`).json()).customManagers;
}

function managerNamed(
  managers: TemplatedManager[],
  prefix: string,
): TemplatedManager {
  const manager = managers.find((candidate) =>
    candidate.description.startsWith(prefix),
  );
  if (manager === undefined) {
    throw new Error(`Renovate manager "${prefix}" is missing`);
  }
  return manager;
}

type Extracted = {
  manager: TemplatedManager;
  file: string;
  text: string;
  depName: string;
  packageName: string | undefined;
  currentValue: string;
  currentDigest: string | undefined;
};

// Renovate applies depNameTemplate to the captured groups.
function templatedDepName(manager: TemplatedManager, depName: string): string {
  return manager.depNameTemplate?.replace("{{{depName}}}", depName) ?? depName;
}

function matchesOf(
  manager: TemplatedManager,
  file: string,
  source: string,
): Extracted[] {
  return manager.matchStrings.flatMap((expression) =>
    [...source.matchAll(new RegExp(expression, "g"))].map((match) => {
      const currentValue = match.groups?.["currentValue"];
      if (currentValue === undefined) {
        throw new Error(`${manager.description}: no currentValue in ${file}`);
      }
      return {
        manager,
        file,
        text: match[0],
        depName: templatedDepName(manager, match.groups?.["depName"] ?? ""),
        packageName: match.groups?.["packageName"],
        currentValue,
        currentDigest: match.groups?.["currentDigest"],
      };
    }),
  );
}

async function extractTemplated(
  manager: TemplatedManager,
  file: string,
): Promise<Extracted[]> {
  return matchesOf(manager, file, await Bun.file(`${root}/${file}`).text());
}

/** Every match of every manager in renovate.json that covers `file`. */
async function extractEveryManager(
  managers: TemplatedManager[],
  file: string,
): Promise<Extracted[]> {
  const source = await Bun.file(`${root}/${file}`).text();
  return managers
    .filter((manager) => managerCoversFile(manager, file))
    .flatMap((manager) => matchesOf(manager, file, source));
}

const STORM_MANIFEST = "packages/the-storm/server/plugins.json";
const STORM_PIN_FILES = [
  STORM_MANIFEST,
  "packages/the-storm/tests/e2e/harness/pins.ts",
  "packages/mc-harness/src/pins.ts",
  "packages/the-storm/plugin/dist/build.gradle.kts",
] as const;
const STORM_SETTINGS_GRADLE = "packages/the-storm/plugin/settings.gradle.kts";
const CATALOG = "packages/version-catalog/src/catalog.json";

// Every quoted download URL in the Minecraft pin files that no manager reads,
// and why. Anything else in those files must be extracted.
const UNTRACKED_MINECRAFT_URLS: Record<string, string> = {
  "https://ci.citizensnpcs.co/job/Citizens2/4269/artifact/dist/target/Citizens-2.0.44-b4269.jar":
    "Storm Citizens: deliberate immutable Jenkins build (packages/the-storm/server/README.md)",
  "https://public.sjer.red/the-storm/plugins/CoreProtect-25.1.jar":
    "Storm CoreProtect: self-hosted copy of an unpublished build",
  "https://download.geysermc.org/v2/projects/floodgate/versions/2.2.5/builds/141/downloads/spigot":
    "Storm floodgate: GeyserMC's download API has no Renovate datasource",
  "https://download.geysermc.org/v2/projects/geyser/versions/2.12.1/builds/1295/downloads/spigot":
    "Storm Geyser: GeyserMC's download API has no Renovate datasource",
  "https://fill-data.papermc.io/v1/objects/9601f9a26a2a52a0f2c807cf1abf691f96ee4fb287878313b601cebc2c51eabf/paper-26.3-244.jar":
    "Storm Paper build: builds ship daily; the manifest and the harness mirror move by hand",
  "https://raw.githubusercontent.com/Shonz1/minecraft-default-configs/6aacbe6355508991ad47b07de8dc7ef1c49430a4/26.3/paper-global.yml":
    "Storm paperDefaults: reference configs pinned to a commit, refreshed with the Paper family",
  "https://raw.githubusercontent.com/Shonz1/minecraft-default-configs/6aacbe6355508991ad47b07de8dc7ef1c49430a4/26.3/paper-world-defaults.yml":
    "Storm paperDefaults: reference configs pinned to a commit, refreshed with the Paper family",
  "https://raw.githubusercontent.com/Shonz1/minecraft-default-configs/6aacbe6355508991ad47b07de8dc7ef1c49430a4/26.3/bukkit.yml":
    "Storm paperDefaults: reference configs pinned to a commit, refreshed with the Paper family",
  "https://raw.githubusercontent.com/Shonz1/minecraft-default-configs/6aacbe6355508991ad47b07de8dc7ef1c49430a4/26.3/spigot.yml":
    "Storm paperDefaults: reference configs pinned to a commit, refreshed with the Paper family",
  "https://cdn.modrinth.com/data/LJNGWSvH/versions/j42l2u1k":
    "GrimAC Gradle Ivy repository; moved by hand with the GrimAC prBodyNotes",
};

function modrinthGameVersion(manager: TemplatedManager): string | undefined {
  const query = new URL(
    (manager.registryUrlTemplate ?? "").replace("{{{packageName}}}", "id"),
  ).searchParams.get("game_versions");
  return z
    .array(z.string())
    .length(1)
    .parse(JSON.parse(query ?? "null"))[0];
}

const StormManifestSchema = z.object({
  paper: z.object({ version: z.string() }),
  plugins: z.array(
    z.object({
      name: z.string(),
      version: z.string(),
      url: z.string(),
      sha256: z.string(),
      file: z.string(),
    }),
  ),
});

async function loadCatalogValue(name: string): Promise<string | undefined> {
  const catalog = parseVersionCatalog(
    await Bun.file(`${root}/${CATALOG}`).json(),
  );
  return catalog.entries.find((entry) => entry.name === name)?.value;
}

test("tracks every Minecraft plugin download URL or records why not", async () => {
  const managers = await loadTemplatedManagers();
  const untracked = new Set<string>();
  for (const file of STORM_PIN_FILES) {
    const source = await Bun.file(`${root}/${file}`).text();
    const extracted = await extractEveryManager(managers, file);
    for (const [quoted] of source.matchAll(/"https:\/\/[^"]+"/gu)) {
      const url = quoted.slice(1, -1);
      if (extracted.some((pin) => pin.text.includes(url))) {
        expect(UNTRACKED_MINECRAFT_URLS[url], `${url} in ${file}`).toBe(
          undefined,
        );
      } else {
        expect(UNTRACKED_MINECRAFT_URLS[url], `${url} in ${file}`).toEqual(
          expect.any(String),
        );
        untracked.add(url);
      }
    }
  }
  const settings = await Bun.file(`${root}/${STORM_SETTINGS_GRADLE}`).text();
  for (const [url] of settings.matchAll(
    /https:\/\/cdn\.modrinth\.com\/[^"\s)]*/gu,
  )) {
    expect(UNTRACKED_MINECRAFT_URLS[url], url).toEqual(expect.any(String));
    untracked.add(url);
  }

  // A stale entry would hide a URL that has since been removed or tracked.
  expect([...untracked].toSorted()).toEqual(
    Object.keys(UNTRACKED_MINECRAFT_URLS).toSorted(),
  );
});

test("orders every Modrinth URL by its file name within one artifact family", async () => {
  const managers = await loadTemplatedManagers();
  const modrinth = managers.filter(
    (manager) => manager.datasourceTemplate === "custom.modrinth",
  );
  expect(modrinth.map((manager) => manager.depNameTemplate)).toEqual([
    "the-storm/{{{depName}}}",
  ]);
  let checked = 0;
  for (const manager of modrinth) {
    const versioning = manager.versioningTemplate;
    if (versioning?.startsWith("regex:") !== true) {
      throw new Error(`${manager.description} has no regex versioning`);
    }
    const ordering = new RegExp(versioning.slice("regex:".length), "u");
    for (const file of STORM_PIN_FILES) {
      if (!managerCoversFile(manager, file)) continue;
      for (const pin of await extractTemplated(manager, file)) {
        const groups = ordering.exec(pin.currentValue)?.groups;
        expect(groups, pin.currentValue).toBeDefined();
        // The compatibility group is the artifact family, so a Fabric or
        // Velocity build of the same project is never offered.
        expect(
          templatedDepName(manager, groups?.["compatibility"] ?? ""),
          pin.currentValue,
        ).toBe(pin.depName);
        expect(groups?.["major"], pin.currentValue).toMatch(/^\d+$/u);
        expect(pin.currentValue).toContain(`/data/${pin.packageName ?? "?"}/`);
        checked += 1;
      }
    }
  }
  // 7 in plugins.json, 3 + 4 in the pins.ts mirrors and 2 in the Gradle
  // runServer task.
  expect(checked).toBe(16);
});

test("asks Modrinth for the Minecraft version each server runs", async () => {
  const managers = await loadTemplatedManagers();
  const manifest = StormManifestSchema.parse(
    await Bun.file(`${root}/${STORM_MANIFEST}`).json(),
  );
  expect(
    modrinthGameVersion(managerNamed(managers, "The Storm Modrinth")),
  ).toBe(manifest.paper.version.split("-")[0]);

  const datasources = z
    .object({
      customDatasources: z.record(
        z.string(),
        z.object({ transformTemplates: z.array(z.string()) }),
      ),
    })
    .parse(await Bun.file(`${root}/renovate.json`).json()).customDatasources;
  expect(datasources["modrinth"]?.transformTemplates).toEqual([
    expect.stringContaining('[$[version_type = "release"].'),
  ]);
  for (const name of ["papermc", "modrinth"]) {
    const transforms = datasources[name]?.transformTemplates;
    expect(transforms, name).toBeDefined();
    for (const transform of transforms ?? []) {
      // JSONata returns a lone result as an object rather than a one-element
      // list unless an array constructor wraps it.
      expect(transform, name).toMatch(/^\{"releases": \[/u);
    }
  }
});

test("bumps every copy of a Storm plugin URL together and leaves the hashes to a reviewer", async () => {
  const config = await loadRenovateConfig();
  const storm = managerNamed(
    await loadTemplatedManagers(),
    "The Storm Modrinth",
  );
  const pinsByFile = await Promise.all(
    STORM_PIN_FILES.map((file) => extractTemplated(storm, file)),
  );
  const pins = pinsByFile.flat();

  // One depName per plugin and every copy agrees, so they share a branch.
  const urls = new Map<string, Set<string>>();
  for (const pin of pins) {
    urls.set(
      pin.depName,
      (urls.get(pin.depName) ?? new Set<string>()).add(pin.currentValue),
    );
  }
  for (const [depName, values] of urls) {
    expect(values.size, depName).toBe(1);
  }
  const manifest = StormManifestSchema.parse(
    await Bun.file(`${root}/${STORM_MANIFEST}`).json(),
  );
  expect(
    pins
      .filter((pin) => pin.file === STORM_MANIFEST)
      .map((pin) => pin.currentValue),
  ).toEqual(
    manifest.plugins
      .map((plugin) => plugin.url)
      .filter((url) => url.startsWith("https://cdn.modrinth.com/")),
  );

  const notes = (depName: string): string =>
    config.packageRules
      .filter(
        (rule) =>
          rule.prBodyNotes !== undefined &&
          rule.matchDepNames !== undefined &&
          matchesName(rule.matchDepNames, depName) &&
          rule.matchDatasources?.includes("custom.modrinth") !== false,
      )
      .flatMap((rule) => rule.prBodyNotes ?? [])
      .join("\n");
  for (const depName of urls.keys()) {
    expect(notes(depName), depName).toContain("**Half upgrade.**");
    expect(notes(depName), depName).toContain("`sha256`");
  }
  const grim = notes("the-storm/grimac-bukkit");
  for (const companion of [
    "libs.versions.toml",
    "settings.gradle.kts",
    "gradle.lockfile",
    "verification-metadata.xml",
  ]) {
    expect(grim).toContain(companion);
  }
  expect(
    await Bun.file(
      `${root}/packages/the-storm/plugin/gradle/libs.versions.toml`,
    ).text(),
  ).toMatch(/^grim = "/mu);

  // ViaBackwards depends on the matching ViaVersion build.
  for (const depName of ["the-storm/ViaVersion", "the-storm/ViaBackwards"]) {
    expect(urls.has(depName), depName).toBe(true);
    expect(
      groupNameFor(config.packageRules, {
        manager: "custom.regex",
        file: STORM_MANIFEST,
        datasource: "custom.modrinth",
        depName,
        packageName: depName,
      }),
    ).toBe("The Storm Via protocol bridge");
  }
});

test("moves BlueMap's version, release URL and file name in one match", async () => {
  const pins = await extractTemplated(
    managerNamed(await loadTemplatedManagers(), "The Storm BlueMap"),
    STORM_MANIFEST,
  );
  const manifest = StormManifestSchema.parse(
    await Bun.file(`${root}/${STORM_MANIFEST}`).json(),
  );
  const bluemap = manifest.plugins.find((plugin) => plugin.name === "BlueMap");
  expect(
    pins.map(({ depName, packageName, currentValue }) => ({
      depName,
      packageName,
      currentValue,
    })),
  ).toEqual([
    {
      depName: "the-storm/BlueMap",
      packageName: "BlueMap-Minecraft/BlueMap",
      currentValue: bluemap?.version,
    },
  ]);
  // Renovate rewrites every occurrence inside the match: the version, the tag
  // and asset name in the URL, and the file name. A hex hash holds none.
  const [pin] = pins;
  expect(pin?.text.split(pin.currentValue)).toHaveLength(5);
  expect(bluemap?.sha256).toMatch(/^[a-f0-9]{64}$/u);
});

test("keeps the itzg/minecraft-server mirrors on the catalog pin and in its group", async () => {
  const config = await loadRenovateConfig();
  const manager = managerNamed(
    await loadTemplatedManagers(),
    "Mirrors of the version catalog's itzg",
  );
  const pin = await loadCatalogValue("itzg/minecraft-server");
  for (const file of manager.managerFilePatterns) {
    const pins = await extractTemplated(manager, file);
    expect(
      pins.map(
        ({ currentValue, currentDigest = "" }) =>
          `${currentValue}@${currentDigest}`,
      ),
      file,
    ).toEqual([pin]);
    expect(
      groupNameFor(config.packageRules, {
        manager: "custom.regex",
        file,
        datasource: "docker",
        depName: "itzg/minecraft-server",
        packageName: "itzg/minecraft-server",
      }),
    ).toBe("itzg/minecraft-server");
  }
});

test("moves the SwiftLint release and builder image with the catalog", async () => {
  const config = await loadRenovateConfig();
  const managers = await loadTemplatedManagers();
  const pinsFile = "ci/scripts/swiftlint/pins.json";
  const swiftlintValue = await loadCatalogValue("realm/SwiftLint");
  const builderValue = await loadCatalogValue("docker.io/library/swift");

  const versions = await extractTemplated(
    managerNamed(managers, "SwiftLint version"),
    pinsFile,
  );
  expect(versions.map((pin) => pin.currentValue)).toEqual([swiftlintValue]);
  const builders = await extractTemplated(
    managerNamed(managers, "SwiftLint builder image"),
    pinsFile,
  );
  expect(
    builders.map((pin) => `${pin.currentValue}@${pin.currentDigest ?? ""}`),
  ).toEqual([builderValue]);
  // The native dockerfile manager reads the ARG default the image builds FROM.
  const builderImage = `docker.io/library/swift:${builderValue ?? ""}`;
  expect(await Bun.file(`${root}/ci/ci-image/Dockerfile`).text()).toContain(
    `ARG SWIFTLINT_BUILDER_IMAGE=${builderImage}\n`,
  );

  for (const [manager, file] of [
    ["custom.regex", CATALOG],
    ["custom.regex", pinsFile],
  ] as const) {
    expect(
      groupNameFor(config.packageRules, {
        manager,
        file,
        datasource: "github-releases",
        depName: "realm/SwiftLint",
        packageName: "realm/SwiftLint",
      }),
    ).toBe("SwiftLint");
  }
  for (const [manager, file] of [
    ["custom.regex", CATALOG],
    ["custom.regex", pinsFile],
    ["dockerfile", "ci/ci-image/Dockerfile"],
  ] as const) {
    expect(
      groupNameFor(config.packageRules, {
        manager,
        file,
        datasource: "docker",
        depName: "docker.io/library/swift",
        packageName: "docker.io/library/swift",
      }),
    ).toBe("SwiftLint builder image");
  }
  // The macOS cross-compiler's Swift image is a separate pin.
  expect(
    groupNameFor(config.packageRules, {
      manager: "custom.regex",
      file: "packages/macos-cross-compiler/sdks.json",
      datasource: "docker",
      depName: "swift",
      packageName: "swift",
    }),
  ).toBeUndefined();
});

test("moves the catalog ffsubsync pin with the hash-locked requirements", async () => {
  const config = await loadRenovateConfig();
  const requirements = "packages/media/scripts/subtitle-requirements.txt";
  const pinned = /^ffsubsync==(?<version>\S+) /mu.exec(
    await Bun.file(`${root}/${requirements}`).text(),
  )?.groups?.["version"];
  expect(await loadCatalogValue("ffsubsync")).toBe(pinned);
  for (const [manager, file] of [
    ["custom.regex", CATALOG],
    ["pip_requirements", requirements],
  ] as const) {
    expect(
      groupNameFor(config.packageRules, {
        manager,
        file,
        datasource: "pypi",
        depName: "ffsubsync",
        packageName: "ffsubsync",
      }),
    ).toBe("ffsubsync");
  }
});

test("leaves only catalog entries without a usable datasource unmanaged", async () => {
  const catalog = parseVersionCatalog(
    await Bun.file(`${root}/${CATALOG}`).json(),
  );
  const unmanaged = catalog.entries.filter(
    (entry) => !entry.management.managed,
  );
  // Each records why in its notes.
  expect(unmanaged.map((entry) => entry.name)).toEqual([
    "bluemap/archive-cli",
    "minecraft/archive-upgrader",
    "itzg/minecraft-server-java17-archive",
    "unmined/unmined-cli",
    "woodpecker-ci/plugin-git",
    "relay-server",
  ]);
  for (const entry of unmanaged) {
    expect(entry.notes?.length, entry.name).toBeGreaterThan(0);
  }

  // The tracked plugin-git image names its untracked macOS release twin.
  const config = await loadRenovateConfig();
  const twin = config.packageRules
    .filter((rule) => rule.matchDepNames?.includes("woodpeckerci/plugin-git"))
    .flatMap((rule) => rule.prBodyNotes ?? [])
    .join("\n");
  expect(twin).toContain("`woodpecker-ci/plugin-git`");
  expect(twin).toContain("darwin-arm64_plugin-git");
});
