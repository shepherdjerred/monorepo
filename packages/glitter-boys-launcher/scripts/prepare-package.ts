import { signArtifact } from "./windows-tools.ts";
import { readProfile } from "./release-profile.ts";
import { copyFile, mkdir, rm, realpath, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const version = (await Bun.file(path.join(root, "Cargo.toml")).text()).match(
  /^version = "([0-9]+\.[0-9]+\.[0-9]+)"/m,
)?.[1];
if (!version) throw new Error("Missing launcher workspace version");
const build = Bun.spawn(
  ["cargo", "build", "--release", "--locked", "--package", "glitter-boys-app"],
  { cwd: root, stdout: "inherit", stderr: "inherit" },
);
if ((await build.exited) !== 0) throw new Error("Launcher build failed");
const target = path.resolve(root, process.env["CARGO_TARGET_DIR"] ?? "target");
const binary = path.join(target, "release", "glitter-boys.exe");
const profile = await readProfile(root);
if (profile.publisher !== null) await signArtifact(root, binary);
const layout = path.join(root, "target", "package-layout");
// Only discard generated packaging output after proving its resolved location.
await mkdir(layout, { recursive: true });
if ((await realpath(layout)) !== path.resolve(layout))
  throw new Error("Packaging layout must not be redirected");
const versions = path.join(layout, "versions");
const existing = await lstat(versions).catch((error: NodeJS.ErrnoException) => {
  if (error.code === "ENOENT") return null;
  throw error;
});
if (
  existing &&
  (existing.isSymbolicLink() ||
    (await realpath(versions)) !== path.resolve(layout, "versions"))
)
  throw new Error("Packaging versions directory must not be redirected");
await rm(versions, { recursive: true, force: true });
const payload = path.join(versions, version);
await mkdir(payload, { recursive: true });
await copyFile(binary, path.join(payload, "glitter-boys.exe"));
await Bun.write(
  path.join(layout, "current.json"),
  JSON.stringify({
    schema: 1,
    version,
    previous: null,
    pending: false,
    attempted: false,
  }),
);
console.log(
  `Prepared ${profile.publisher === null ? "unsigned preview" : "signed"} launcher ${version}`,
);
