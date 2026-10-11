import { cp, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const packageRoot = path.resolve(import.meta.dir, "..");
const fixture = path.resolve(
  packageRoot,
  "../tasknotes-fixtures/e2e/local-vault",
);
const bundleID = "org.reactjs.native.example.TasksForObsidian";
const uuid = z.uuid();
const deviceType = "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro";
const runID = crypto.randomUUID();
const evidence = path.join(packageRoot, ".build/native-e2e", runID);
const derived = path.join(packageRoot, ".build/ios-e2e");
const resultBundle = path.join(evidence, "Smoke.xcresult");

async function command(
  argv: string[],
  capture = false,
  cwd = packageRoot,
): Promise<string> {
  const child = Bun.spawn(argv, {
    cwd,
    env: { ...Bun.env, MISE_EXEC_AUTO_INSTALL: "false" },
    stdout: capture ? "pipe" : "inherit",
    stderr: "inherit",
  });
  const output = capture ? await new Response(child.stdout).text() : "";
  const status = await child.exited;
  if (status !== 0) {
    throw new Error(
      `${argv.slice(0, 2).join(" ")} exited with ${String(status)}`,
    );
  }
  return output.trim();
}

export async function verifyVault(vault: string): Promise<void> {
  for (const relative of [
    "Tasks/Existing.md",
    "Reference.md",
    "tasknotes.yaml",
  ]) {
    const original = await readFile(path.join(fixture, relative));
    const actual = await readFile(path.join(vault, relative));
    if (!original.equals(actual))
      throw new Error(`Fixture changed: ${relative}`);
  }
  const markdown = [...new Bun.Glob("**/*.md").scanSync({ cwd: vault })];
  if (markdown.length !== 3) {
    throw new Error(
      `Expected two task notes and one reference note, got ${String(markdown.length)}`,
    );
  }
  const created = markdown.filter(
    (entry) => !["Tasks/Existing.md", "Reference.md"].includes(entry),
  );
  const createdPath = z.tuple([z.string()]).parse(created)[0];
  const content = await Bun.file(path.join(vault, createdPath)).text();
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(
    content,
  )?.[1];
  if (frontmatter === undefined)
    throw new Error("Created note has no YAML frontmatter");
  z.object({
    title: z.literal("E2E edited task"),
    status: z.literal("done"),
    tags: z.array(z.string()).refine((tags) => tags.includes("task")),
    completedDate: z.string().min(1),
  }).parse(Bun.YAML.parse(frontmatter));
  console.log(
    `Verified persisted title/completion and unchanged fixture bytes: ${createdPath}`,
  );
}

async function isolatedTestRun(device: string): Promise<string> {
  const products = path.join(derived, "Build/Products");
  const filename = z
    .tuple([z.string()])
    .parse([...new Bun.Glob("*.xctestrun").scanSync({ cwd: products })])[0];
  const testRun = path.join(products, filename);
  const configuration = z
    .object({
      __xctestrun_metadata__: z.object({ FormatVersion: z.literal(1) }),
      TasksForObsidianUITests: z.object({
        BlueprintName: z.literal("TasksForObsidianUITests"),
        EnvironmentVariables: z.record(z.string(), z.string()),
        SystemAttachmentLifetime: z.enum(["deleteOnSuccess", "keepAlways"]),
      }),
    })
    .parse(
      JSON.parse(
        await command(["plutil", "-convert", "json", "-o", "-", testRun], true),
      ),
    );
  const environment =
    configuration.TasksForObsidianUITests.EnvironmentVariables;
  const key = "TasksForObsidianUITests.EnvironmentVariables";
  await command([
    "plutil",
    environment["FACET_E2E_SIMULATOR"] === undefined ? "-insert" : "-replace",
    `${key}.FACET_E2E_SIMULATOR`,
    "-string",
    device,
    testRun,
  ]);
  await command([
    "plutil",
    "-replace",
    "TasksForObsidianUITests.SystemAttachmentLifetime",
    "-string",
    "keepAlways",
    testRun,
  ]);
  return testRun;
}

async function writeProvenance(device: string, app: string): Promise<void> {
  const sourceHead = await command(["git", "rev-parse", "HEAD"], true);
  const sourceDiff = await command(
    [
      "git",
      "diff",
      "HEAD",
      "--",
      "ios",
      "scripts",
      "../tasknotes-macos",
      "../tasknotes-core",
      "../tasknotes-fixtures",
    ],
    true,
  );
  const artifactFiles: Record<string, string> = {};
  const files = [
    ...new Bun.Glob("**/*").scanSync({ cwd: app, onlyFiles: true }),
  ].sort();
  for (const file of files) {
    artifactFiles[file] = new Bun.CryptoHasher("sha256")
      .update(await Bun.file(path.join(app, file)).bytes())
      .digest("hex");
  }
  const sourceFiles = [
    "scripts/ios-native-e2e.ts",
    "ios/FacetUITests/StandaloneTaskTests.swift",
    "../tasknotes-fixtures/e2e/local-vault/tasknotes.yaml",
    "../tasknotes-fixtures/e2e/local-vault/Tasks/Existing.md",
    "../tasknotes-fixtures/e2e/local-vault/Reference.md",
  ];
  const fingerprints: Record<string, string> = {};
  for (const file of sourceFiles) {
    fingerprints[file] = new Bun.CryptoHasher("sha256")
      .update(await Bun.file(path.resolve(packageRoot, file)).bytes())
      .digest("hex");
  }
  await Bun.write(
    path.join(evidence, "provenance.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        runID,
        device,
        deviceType,
        sourceHead,
        sourceDiffSHA256: new Bun.CryptoHasher("sha256")
          .update(sourceDiff)
          .digest("hex"),
        artifactFiles,
        fingerprints,
      },
      null,
      2,
    ),
  );
}

async function runJourney(device: string, testRun: string): Promise<void> {
  await command([
    "xcodebuild",
    "test-without-building",
    "-xctestrun",
    testRun,
    "-destination",
    `platform=iOS Simulator,id=${device}`,
    "-parallel-testing-enabled",
    "NO",
    "-resultBundlePath",
    resultBundle,
    "-only-testing:TasksForObsidianUITests/StandaloneTaskTests",
    "-collect-test-diagnostics",
    "never",
  ]);
}

async function preflight(): Promise<void> {
  await command(
    ["cargo", "xtask", "check-xcframework"],
    false,
    path.resolve(packageRoot, "../tasknotes-core"),
  );
  const info = path.resolve(
    packageRoot,
    "../tasknotes-core/bindings/artifacts/TaskNotesCoreFFI.xcframework/Info.plist",
  );
  const metadata = z
    .object({
      AvailableLibraries: z.array(
        z.object({
          SupportedPlatform: z.string(),
          SupportedPlatformVariant: z.string().optional(),
        }),
      ),
    })
    .parse(
      JSON.parse(
        await command(["plutil", "-convert", "json", "-o", "-", info], true),
      ),
    );
  if (
    !metadata.AvailableLibraries.some(
      (entry) =>
        entry.SupportedPlatform === "ios" &&
        entry.SupportedPlatformVariant === "simulator",
    )
  ) {
    throw new Error(
      "Build the matching XCFramework with --platform macos --platform ios-sim before running iOS E2E",
    );
  }
  await command(["bun", "run", "ios:native:generate"]);
}

async function installedVault(device: string): Promise<string> {
  const container = await command(
    ["xcrun", "simctl", "get_app_container", device, bundleID, "data"],
    true,
  );
  if (!path.isAbsolute(container) || path.basename(container) === "") {
    throw new Error("Invalid simulator app container");
  }
  return path.join(container, "Documents/Native acceptance");
}

async function retainEvidence(device: string, seeded: boolean): Promise<void> {
  const results = await Promise.allSettled([
    (async () => {
      // Xcode may relocate the data container when installing a test build.
      if (seeded)
        await cp(await installedVault(device), path.join(evidence, "vault"), {
          recursive: true,
        });
    })(),
    (async () => {
      if (await Bun.file(path.join(resultBundle, "Info.plist")).exists()) {
        await command([
          "xcrun",
          "xcresulttool",
          "export",
          "attachments",
          "--path",
          resultBundle,
          "--output-path",
          path.join(evidence, "screenshots"),
        ]);
      }
    })(),
  ]);
  const failures: unknown[] = [];
  for (const result of results) {
    if (result.status === "rejected") failures.push(result.reason);
  }
  if (failures.length > 0)
    throw new AggregateError(failures, "Could not retain native E2E evidence");
}

async function main(): Promise<void> {
  if (process.platform !== "darwin")
    throw new Error("Native iOS E2E requires macOS and Xcode");
  if (Bun.argv.length !== 2)
    throw new Error(
      "ios:native:e2e takes no arguments; it always creates a disposable simulator",
    );
  await mkdir(evidence, { recursive: true });
  await preflight();
  const device = uuid.parse(
    await command(
      ["xcrun", "simctl", "create", `Facet E2E ${runID}`, deviceType],
      true,
    ),
  );
  const xcode = [
    "-project",
    "ios/TasksForObsidian.xcodeproj",
    "-scheme",
    "TasksForObsidian",
    "-configuration",
    "Debug",
    "-derivedDataPath",
    derived,
    "-destination",
    `platform=iOS Simulator,id=${device}`,
    "-parallel-testing-enabled",
    "NO",
    "CODE_SIGNING_ALLOWED=YES",
    "CODE_SIGN_IDENTITY=-",
  ];
  let seeded = false;
  const failures: unknown[] = [];
  try {
    console.log(`Disposable simulator: ${device}. Evidence: ${evidence}`);
    await command(["xcrun", "simctl", "boot", device]);
    await command(["xcrun", "simctl", "bootstatus", device, "-b"]);
    await command(["xcodebuild", "build-for-testing", ...xcode]);
    const app = path.join(
      derived,
      "Build/Products/Debug-iphonesimulator/TasksForObsidian.app",
    );
    await command(["xcrun", "simctl", "install", device, app]);
    await cp(fixture, await installedVault(device), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    seeded = true;
    const testRun = await isolatedTestRun(device);
    await writeProvenance(device, app);
    await runJourney(device, testRun);
    await verifyVault(await installedVault(device));
  } catch (error) {
    failures.push(error);
  }
  try {
    // Retain result bundles and synthetic vault bytes before deleting only our
    // newly created simulator. Never select, reset or uninstall on a user device.
    try {
      await retainEvidence(device, seeded);
    } finally {
      try {
        await command(["xcrun", "simctl", "shutdown", device]);
      } finally {
        await command(["xcrun", "simctl", "delete", device]);
      }
    }
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0)
    throw new AggregateError(
      failures,
      "Native iOS E2E failed; inspect the retained evidence",
    );
}

if (import.meta.main) await main();
