// The cargo-packager `beforePackagingCommand`: builds the release binary with
// the profile's compiled-in settings and stages it under the profile's
// installer binary name. NSIS keys its process kill, shortcuts and uninstall
// on that name, so beta stages `scout-client-beta` and installs beside stable.
// It also assembles the voice models that packaging/*.json ships as a resource.
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

const build = Bun.spawn(
  ["cargo", "build", "--release", "--locked", "--package", "scout-client-app"],
  {
    cwd: root,
    env: { ...process.env, SCOUT_DESKTOP_PROFILE: channel },
    stdout: "inherit",
    stderr: "inherit",
  },
);
if ((await build.exited) !== 0) {
  throw new Error("cargo build failed");
}

const extension = process.platform === "win32" ? ".exe" : "";
const staged = join(root, "target/package", channel);
await mkdir(staged, { recursive: true });
await copyFile(
  join(root, `target/release/scout-client${extension}`),
  join(staged, `${binaryName}${extension}`),
);
