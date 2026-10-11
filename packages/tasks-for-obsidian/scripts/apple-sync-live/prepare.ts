import { cp, mkdir, readFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  packageRoot,
  provenancePaths,
  root,
  fixtures,
  iosBundle,
  macBundle,
  deviceType,
  uuid,
  requiredCases,
  ManifestSchema,
  type Manifest,
  digest,
  verifyReplica,
  runDirectory,
  atomicJSON,
} from "./model";
import { command, save, writeDescriptors } from "./platform";

export async function seed(directory: string) {
  await cp(path.join(fixtures, "e2e/local-vault"), directory, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  // The live case must exercise official plugin settings ingestion. A portable
  // YAML configuration would take precedence and hide that interoperability.
  await unlink(path.join(directory, "tasknotes.yaml"));
  const source = path.join(fixtures, "vault/upstream/config.json");
  const corpus = z
    .array(z.looseObject({ id: z.string(), input: z.unknown() }))
    .parse(await Bun.file(source).json());
  const fixture = corpus.find((entry) => entry.id === "config.0659");
  if (fixture === undefined)
    throw new Error("Pinned plugin mapping fixture is missing");
  const input = z
    .object({ data: z.record(z.string(), z.unknown()) })
    .parse(fixture.input);
  await atomicJSON(
    path.join(directory, ".obsidian/plugins/tasknotes/data.json"),
    {
      ...input.data,
      storeTitleInFilename: false,
      taskCreationDefaults: { useBodyTemplate: false },
    },
  );
  await Bun.write(
    path.join(directory, "Tasks/Existing.md"),
    "---\ntitle: E2E existing task\nstatus: open\npriority: normal\ntags: [task]\ndateCreated: 2026-10-01T00:00:00Z\ndateModified: 2026-10-01T00:00:00Z\ncustom_property: preserved\n---\nLive Sync preservation sentinel.\n",
  );
  await mkdir(path.join(directory, "Attachments"), { recursive: true });
  await Bun.write(
    path.join(directory, "Attachments/empty.bin"),
    new Uint8Array(0),
  );
  const binary = Uint8Array.from(
    { length: 2 * 1024 * 1024 + 1024 },
    (_, index) => index % 251,
  );
  await Bun.write(path.join(directory, "Attachments/multi-piece.bin"), binary);
  const reference: Manifest["reference"] = {};
  for (const relative of [
    ...new Bun.Glob("**/*").scanSync({
      cwd: directory,
      dot: true,
      onlyFiles: true,
    }),
  ].sort()) {
    const bytes = await readFile(path.join(directory, relative));
    reference[relative] = { size: bytes.length, sha256: digest(bytes) };
  }
  return { reference, pluginFixtureSHA256: digest(await readFile(source)) };
}

export async function fingerprintApp(app: string) {
  const files: Record<string, string> = {};
  for (const relative of [
    ...new Bun.Glob("**/*").scanSync({ cwd: app, dot: true, onlyFiles: true }),
  ].sort())
    files[relative] = digest(await readFile(path.join(app, relative)));
  return files;
}

async function sourceFingerprints() {
  const listing = await command(
    [
      "git",
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      ...provenancePaths,
    ],
    root,
  );
  const files: Record<string, string> = {};
  for (const filename of listing.split("\n").filter(Boolean).sort())
    files[filename] = digest(await readFile(path.join(root, filename)));
  return files;
}

export async function prepare() {
  const runID = crypto.randomUUID().toLowerCase();
  const directory = runDirectory(runID);
  await mkdir(directory, { recursive: false, mode: 0o700 });
  const seeded = await seed(path.join(directory, "reference-vault"));
  const manifest: Manifest = {
    schemaVersion: 1,
    runID,
    createdAt: new Date().toISOString(),
    round: 1,
    failures: [],
    completedRounds: [],
    operations: {},
    simulator: null,
    stage: "preparing",
    allowedRemoteVaultID: null,
    clients: null,
    ...seeded,
    cases: ManifestSchema.shape.cases.parse(
      Object.fromEntries(requiredCases.map((entry) => [entry, "pending"])),
    ),
  };
  await save(manifest);
  console.log(`Preparing owned live run ${runID}`);
  try {
    const sourceFiles = await sourceFingerprints();
    await command(
      ["cargo", "xtask", "check-xcframework"],
      path.resolve(packageRoot, "../tasknotes-core"),
      {},
      { timeoutMS: 900_000 },
    );
    await command(["bun", "run", "ios:native:generate"]);
    await command(
      ["xcodegen", "generate"],
      path.resolve(packageRoot, "../tasknotes-macos"),
    );
    const name = `Facet Live Sync ${runID}`;
    manifest.simulator = {
      name,
      id: uuid.parse(
        await command(["xcrun", "simctl", "create", name, deviceType]),
      ),
    };
    await save(manifest);
    const device = manifest.simulator.id;
    await command(["xcrun", "simctl", "boot", device]);
    await command(["xcrun", "simctl", "bootstatus", device, "-b"]);
    for (const client of ["ios", "macos"] as const) {
      const mac = client === "macos";
      await command(
        [
          "xcodebuild",
          "build-for-testing",
          "-project",
          mac
            ? "../tasknotes-macos/TaskNotes.xcodeproj"
            : "ios/TasksForObsidian.xcodeproj",
          "-scheme",
          mac ? "TaskNotesAcceptance" : "TasksForObsidian",
          "-configuration",
          "Debug",
          "-derivedDataPath",
          path.join(directory, client),
          "-destination",
          mac ? "platform=macOS" : `platform=iOS Simulator,id=${device}`,
          "CODE_SIGNING_ALLOWED=YES",
          "CODE_SIGN_IDENTITY=-",
        ],
        packageRoot,
        {},
        {
          logFile: path.join(directory, `${client}-build.log`),
          timeoutMS: 900_000,
        },
      );
    }
    const iosApp = path.join(
      directory,
      "ios/Build/Products/Debug-iphonesimulator/TasksForObsidian.app",
    );
    const macApp = path.join(
      directory,
      "macos/Build/Products/Debug/FacetAcceptance.app",
    );
    await command(["xcrun", "simctl", "install", device, iosApp]);
    const iosContainer = await command([
      "xcrun",
      "simctl",
      "get_app_container",
      device,
      iosBundle,
      "data",
    ]);
    const macContainer = path.join(
      os.homedir(),
      "Library/Containers",
      macBundle,
      "Data",
    );
    manifest.clients = {
      ios: {
        container: iosContainer,
        descriptor: path.join(iosContainer, "Documents/acceptance.json"),
        stateDirectory: path.join(
          iosContainer,
          "Library/Application Support/FacetAcceptance",
          runID,
        ),
      },
      macos: {
        container: macContainer,
        descriptor: path.join(
          macContainer,
          "Library/Application Support/FacetAcceptance",
          runID,
          "acceptance.json",
        ),
        stateDirectory: path.join(
          macContainer,
          "Library/Application Support/FacetAcceptance",
          runID,
        ),
      },
    };
    await writeDescriptors(manifest, null);
    if (
      JSON.stringify(await sourceFingerprints()) !== JSON.stringify(sourceFiles)
    )
      throw new Error(
        "Source changed during native preparation; retain this failed run and rebuild from one source state",
      );
    await atomicJSON(path.join(directory, "provenance.json"), {
      schemaVersion: 1,
      runID,
      sourceHead: await command(["git", "rev-parse", "HEAD"], root),
      sourceFiles,
      iosApp: await fingerprintApp(iosApp),
      macApp: await fingerprintApp(macApp),
      pluginSettingsFixture: {
        id: "config.0659",
        sourceSHA256: manifest.pluginFixtureSHA256,
      },
      expectedTaskNotesVersion: "4.13.8",
      officialObsidianVersion: null,
    });
    manifest.stage = "owner-setup";
    await save(manifest);
    console.log(
      `Reference vault: ${path.join(directory, "reference-vault")}\nOpen that folder in official Obsidian, install/enable TaskNotes 4.13.8, create a NEW encrypted remote vault named Facet Sync Acceptance ${runID}. Enable Sync all other types and vault configuration/plugin data, restart and let Sync finish. Store its separate vault password in 1Password. No recordings during credential entry.\nThen run in order:\nbun run apple:sync:live seal-reference ${runID}\nbun run apple:sync:live discover ${runID}\nSign in manually with recording off and identify only the exact synthetic vault.\nbun run apple:sync:live bind-vault ${runID} <nonsecret-remote-vault-id>\nbun run apple:sync:live resume ${runID}`,
    );
  } catch (error) {
    manifest.stage = "failed";
    await save(manifest);
    throw error;
  }
}

export async function sealReference(manifest: Manifest) {
  if (manifest.stage !== "owner-setup")
    throw new Error("Seal the official reference before binding live clients");
  const directory = path.join(runDirectory(manifest.runID), "reference-vault");
  const settingsPath = ".obsidian/plugins/tasknotes/data.json";
  const originalSettings = manifest.reference[settingsPath];
  if (originalSettings === undefined)
    throw new Error("Missing seeded plugin settings");
  for (const [relative, expected] of Object.entries(manifest.reference)) {
    if (relative === settingsPath) continue;
    const bytes = await readFile(path.join(directory, relative));
    if (bytes.length !== expected.size || digest(bytes) !== expected.sha256)
      throw new Error(`Official setup changed a synthetic seed: ${relative}`);
  }
  const plugin = z
    .object({ id: z.literal("tasknotes"), version: z.literal("4.13.8") })
    .parse(
      await Bun.file(
        path.join(directory, ".obsidian/plugins/tasknotes/manifest.json"),
      ).json(),
    );
  const enabled = z
    .array(z.string())
    .parse(
      await Bun.file(
        path.join(directory, ".obsidian/community-plugins.json"),
      ).json(),
    );
  if (!enabled.includes(plugin.id))
    throw new Error("TaskNotes 4.13.8 must be enabled in official Obsidian");
  const settings = await readFile(path.join(directory, settingsPath));
  z.object({
    storeTitleInFilename: z.literal(false),
    defaultTaskStatus: z.literal("open"),
    defaultTaskPriority: z.literal("normal"),
    fieldMapping: z.object({
      title: z.literal("title"),
      status: z.literal("status"),
    }),
  }).parse(JSON.parse(settings.toString("utf8")));
  const officialVersion = await command([
    "plutil",
    "-extract",
    "CFBundleShortVersionString",
    "raw",
    "-o",
    "-",
    "/Applications/Obsidian.app/Contents/Info.plist",
  ]);
  z.string().min(1).max(64).parse(officialVersion);
  manifest.reference[settingsPath] = {
    size: settings.length,
    sha256: digest(settings),
  };
  await verifyReplica(directory, manifest.reference);
  await atomicJSON(
    path.join(runDirectory(manifest.runID), "official-reference.json"),
    {
      schemaVersion: 1,
      runID: manifest.runID,
      capturedAt: new Date().toISOString(),
      officialVersion,
      taskNotesVersion: plugin.version,
      pluginManifestSHA256: digest(
        await readFile(
          path.join(directory, ".obsidian/plugins/tasknotes/manifest.json"),
        ),
      ),
      seededSettingsSHA256: originalSettings.sha256,
      normalizedSettingsSHA256: digest(settings),
    },
  );
  manifest.cases["official-reference"] = "pass";
  await save(manifest);
  console.log(
    "Official Obsidian version, enabled TaskNotes 4.13.8, supported settings and unchanged seed bytes verified. Normalized plugin settings sealed.",
  );
}
