// The cargo-packager `beforePackagingCommand`: builds the release binary with
// the profile's compiled-in settings and stages it under the profile's
// installer binary name. NSIS keys its process kill, shortcuts and uninstall
// on that name, so beta stages `scout-client-beta` and installs beside stable.
// It also assembles the voice models that packaging/*.json ships as a resource.
// With SCOUT_DESKTOP_TARGET=universal-apple-darwin (set by the macOS release
// lane, package-macos.ts) it builds the arm64 and x86_64 slices and joins them
// with `lipo` into one universal binary.
//   bun scripts/prepare-package.ts stable|beta
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MODEL_STAGING_DIRECTORY } from "./voice-model-files.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const channel = process.argv[2];
if (channel !== "stable" && channel !== "beta") {
  throw new Error("usage: prepare-package.ts stable|beta");
}
const profile: unknown = JSON.parse(
  await readFile(join(root, `release-profiles/${channel}.json`), "utf8"),
);
const binaryName =
  typeof profile === "object" &&
  profile !== null &&
  "binary_name" in profile &&
  typeof profile.binary_name === "string"
    ? profile.binary_name
    : undefined;
if (binaryName === undefined) {
  throw new Error(`release-profiles/${channel}.json has no binary_name`);
}

// The voice models ship as the `voice-models` resource in packaging/*.json.
// Assemble them fresh so a stale or partial directory is never packaged;
// fetch-voice-models.ts checks every SHA-256 and throws on a mismatch.
const modelDirectory = join(root, MODEL_STAGING_DIRECTORY);
await rm(modelDirectory, { recursive: true, force: true });
const fetchModels = Bun.spawn(
  ["bun", "scripts/fetch-voice-models.ts", modelDirectory],
  { cwd: root, stdout: "inherit", stderr: "inherit" },
);
if ((await fetchModels.exited) !== 0) {
  throw new Error("assembling the voice models failed");
}

async function run(command: string[], failure: string): Promise<void> {
  const child = Bun.spawn(command, {
    cwd: root,
    env: { ...process.env, SCOUT_DESKTOP_PROFILE: channel },
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await child.exited) !== 0) {
    throw new Error(failure);
  }
}

const cargoBuild = [
  "cargo",
  "build",
  "--release",
  "--locked",
  "--package",
  "scout-client-app",
];
const staged = join(root, "target/package", channel);
await mkdir(staged, { recursive: true });
const target = process.env["SCOUT_DESKTOP_TARGET"];
if (target === undefined || target === "") {
  await run(cargoBuild, "cargo build failed");
  const extension = process.platform === "win32" ? ".exe" : "";
  await copyFile(
    join(root, `target/release/scout-client${extension}`),
    join(staged, `${binaryName}${extension}`),
  );
} else if (
  target === "universal-apple-darwin" &&
  process.platform === "darwin"
) {
  const slices = ["aarch64-apple-darwin", "x86_64-apple-darwin"];
  for (const slice of slices) {
    await run(
      [...cargoBuild, "--target", slice],
      `cargo build ${slice} failed`,
    );
  }
  await run(
    [
      "lipo",
      "-create",
      "-output",
      join(staged, binaryName),
      ...slices.map((slice) =>
        join(root, `target/${slice}/release/scout-client`),
      ),
    ],
    "lipo could not join the slices",
  );
} else {
  throw new Error(
    `SCOUT_DESKTOP_TARGET=${target} is not a release target on ${process.platform}; only universal-apple-darwin on macOS is`,
  );
}
