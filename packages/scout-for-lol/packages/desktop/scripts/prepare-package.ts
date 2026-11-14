// The cargo-packager `beforePackagingCommand`: builds the release binary with
// the profile's compiled-in settings and stages it under the profile's
// installer binary name. NSIS keys its process kill, shortcuts and uninstall
// on that name, so beta stages `scout-client-beta` and installs beside stable.
//   bun scripts/prepare-package.ts stable|beta
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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
