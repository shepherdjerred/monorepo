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
  activeClients,
} from "./model";
import { command, save, writeDescriptors } from "./platform";
import { inspectOfficialPlugin } from "./official-plugin";

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
  const officialStatuses = z
    .object({
      version: z.literal("4.13.8"),
      statuses: z
        .array(
          z.strictObject({
            id: z.string().min(1),
            value: z.string().min(1),
            label: z.string().min(1),
            color: z.string().min(1),
            isCompleted: z.boolean(),
            excludeFromCycle: z.boolean(),
            order: z.number(),
            autoArchive: z.boolean(),
            autoArchiveDelay: z.number(),
          }),
        )
        .min(1),
    })
    .parse(
      await Bun.file(
        path.join(fixtures, "vault/tasknotes-4.13.8-statuses.json"),
      ).json(),
    );
  await atomicJSON(
    path.join(directory, ".obsidian/plugins/tasknotes/data.json"),
    {
      ...input.data,
      // The mapping oracle deliberately contains partial status entries. Real
      // plugin settings require the complete pinned official definitions.
      customStatuses: officialStatuses.statuses,
      storeTitleInFilename: false,
      taskCreationDefaults: { useBodyTemplate: false },
      starterNoteCreated: true,
      autoCreateDefaultBasesFiles: false,
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

export type PreparationScope = "apple" | "macos";

export function parsePreparationArguments(args: string[]): PreparationScope {
  if (args.length === 0) return "apple";
  z.tuple([z.literal("--clients"), z.literal("macos")]).parse(args);
  return "macos";
}

export async function prepare(scope: PreparationScope = "apple") {
  const runnerIdentity = z
    .string()
    .regex(/^[a-f0-9]{40}$/iu)
    .optional()
    .parse(Bun.env["TASKNOTES_UITEST_IDENTITY"]);
  const runID = crypto.randomUUID().toLowerCase();
  const directory = runDirectory(runID);
  await mkdir(directory, { recursive: false, mode: 0o700 });
  const seeded = await seed(path.join(directory, "reference-vault"));
  const manifest = ManifestSchema.parse({
    ...(scope === "macos" ? { schemaVersion: 2, scope } : { schemaVersion: 1 }),
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
    cases: Object.fromEntries(requiredCases.map((entry) => [entry, "pending"])),
  });
  await save(manifest);
  console.log(`Preparing owned live run ${runID}`);
  try {
    const sourceFiles = await sourceFingerprints();
    const { iosApp, macApp } = await prepareNativeClients(
      manifest,
      command,
      save,
      runnerIdentity,
    );
    await writeDescriptors(manifest, null);
    if (
      JSON.stringify(await sourceFingerprints()) !== JSON.stringify(sourceFiles)
    )
      throw new Error(
        "Source changed during native preparation; retain this failed run and rebuild from one source state",
      );
    let scopeProvenance;
    if (manifest.schemaVersion === 2) {
      scopeProvenance = { schemaVersion: 2, scope: manifest.scope };
    } else {
      if (iosApp === undefined) throw new Error("Missing built iOS artifact");
      scopeProvenance = {
        schemaVersion: 1,
        iosApp: await fingerprintApp(iosApp),
      };
    }
    await atomicJSON(path.join(directory, "provenance.json"), {
      ...scopeProvenance,
      runID,
      sourceHead: await command(["git", "rev-parse", "HEAD"], root),
      sourceFiles,
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
      `Reference vault: ${path.join(directory, "reference-vault")}\nOpen that folder in official Obsidian, install/enable TaskNotes 4.13.8, and connect only the designated synthetic encrypted remote vault. Enable Sync all other types and vault configuration, including Installed community plugins (which includes plugin settings), restart and let Sync finish. Store its separate vault password in 1Password. No recordings during credential entry.\nSelected clients: ${activeClients(manifest).join(", ")} (${String(activeClients(manifest).length + 1)} replicas including official Obsidian).\nThen run in order:\nbun run apple:sync:live seal-reference ${runID}\nbun run apple:sync:live discover ${runID}\nSign in manually with recording off and identify only the exact synthetic vault.\nbun run apple:sync:live bind-vault ${runID} <nonsecret-remote-vault-id>\nbun run apple:sync:live resume ${runID}`,
    );
  } catch (error) {
    manifest.stage = "failed";
    await save(manifest);
    throw error;
  }
}

export async function prepareNativeClients(
  manifest: Manifest,
  runCommand: typeof command = command,
  saveManifest: typeof save = save,
  runnerIdentity?: string,
) {
  if (runnerIdentity !== undefined)
    z.string()
      .regex(/^[a-f0-9]{40}$/iu)
      .parse(runnerIdentity);
  const runID = manifest.runID;
  await runCommand(
    ["cargo", "xtask", "check-xcframework"],
    path.resolve(packageRoot, "../tasknotes-core"),
    {},
    { timeoutMS: 900_000 },
  );
  if (manifest.schemaVersion === 1)
    await runCommand(["bun", "run", "ios:native:generate"]);
  await runCommand(
    ["xcodegen", "generate"],
    path.resolve(packageRoot, "../tasknotes-macos"),
  );
  if (manifest.schemaVersion === 1) {
    const name = `Facet Live Sync ${runID}`;
    manifest.simulator = {
      name,
      id: uuid.parse(
        await runCommand(["xcrun", "simctl", "create", name, deviceType]),
      ),
    };
    await saveManifest(manifest);
    const device = manifest.simulator.id;
    await runCommand(["xcrun", "simctl", "boot", device]);
    await runCommand(["xcrun", "simctl", "bootstatus", device, "-b"]);
  }
  await buildNativeClients(manifest, runCommand, runnerIdentity);
  return assignPreparedClients(manifest, runCommand);
}

async function buildNativeClients(
  manifest: Manifest,
  runCommand: typeof command,
  runnerIdentity?: string,
) {
  const directory = runDirectory(manifest.runID);
  for (const client of activeClients(manifest)) {
    const mac = client === "macos";
    let destination = "platform=macOS";
    if (!mac) {
      if (manifest.simulator === null)
        throw new Error("Missing owned simulator");
      destination = `platform=iOS Simulator,id=${manifest.simulator.id}`;
    }
    await runCommand(
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
        destination,
        "CODE_SIGNING_ALLOWED=YES",
        ...(mac
          ? runnerIdentity === undefined
            ? []
            : [`TASKNOTES_UITEST_IDENTITY=${runnerIdentity}`]
          : ["CODE_SIGN_IDENTITY=-"]),
      ],
      packageRoot,
      {},
      {
        logFile: path.join(directory, `${client}-build.log`),
        timeoutMS: 900_000,
      },
    );
  }
}

async function assignPreparedClients(
  manifest: Manifest,
  runCommand: typeof command,
) {
  const runID = manifest.runID;
  const directory = runDirectory(runID);
  const iosApp = path.join(
    directory,
    "ios/Build/Products/Debug-iphonesimulator/TasksForObsidian.app",
  );
  const macApp = path.join(
    directory,
    "macos/Build/Products/Debug/FacetAcceptance.app",
  );
  let iosContainer: string | undefined;
  if (manifest.schemaVersion === 1) {
    if (manifest.simulator === null) throw new Error("Missing owned simulator");
    const device = manifest.simulator.id;
    await runCommand(["xcrun", "simctl", "install", device, iosApp]);
    iosContainer = await runCommand([
      "xcrun",
      "simctl",
      "get_app_container",
      device,
      iosBundle,
      "data",
    ]);
  }
  const macContainer = path.join(
    os.homedir(),
    "Library/Containers",
    macBundle,
    "Data",
  );
  const macos = {
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
  };
  if (manifest.schemaVersion === 2) {
    manifest.clients = { macos };
  } else {
    if (iosContainer === undefined) throw new Error("Missing iOS container");
    manifest.clients = {
      macos,
      ios: {
        container: iosContainer,
        descriptor: path.join(iosContainer, "Documents/acceptance.json"),
        stateDirectory: path.join(
          iosContainer,
          "Library/Application Support/FacetAcceptance",
          runID,
        ),
      },
    };
  }
  return { iosApp: manifest.schemaVersion === 1 ? iosApp : undefined, macApp };
}

export async function sealReference(manifest: Manifest) {
  if (manifest.stage !== "owner-setup")
    throw new Error("Seal the official reference before binding live clients");
  const directory = path.join(runDirectory(manifest.runID), "reference-vault");
  const settingsPath = ".obsidian/plugins/tasknotes/data.json";
  const pluginEvidence = await inspectOfficialPlugin(
    path.join(directory, ".obsidian/plugins/tasknotes"),
  );
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
      pluginEvidence,
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
