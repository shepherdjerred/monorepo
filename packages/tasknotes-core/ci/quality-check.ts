import path from "node:path";

const workspaceRoot = path.resolve(import.meta.dir, "..");
const violations: string[] = [];
const members = await workspaceMembers();
const itemLevelAllow = ["#[", "allow("].join("");
const crateLevelAllow = ["#![", "allow("].join("");

for (const file of new Bun.Glob("**/*.rs").scanSync({
  cwd: workspaceRoot,
  onlyFiles: true,
})) {
  if (file.startsWith("target/") || file.includes("/target/")) {
    continue;
  }
  const text = await Bun.file(path.join(workspaceRoot, file)).text();
  if (text.includes(itemLevelAllow) || text.includes(crateLevelAllow)) {
    violations.push(
      `${file}: Rust allow attributes are banned; use an expiring #[expect(..., reason = "...")]`,
    );
  }
}

for (const member of members) {
  const manifestPath = path.join(workspaceRoot, member, "Cargo.toml");
  if (!(await Bun.file(manifestPath).exists())) {
    violations.push(
      `${member}/Cargo.toml: workspace member manifest is missing`,
    );
    continue;
  }
  const manifest = await Bun.file(manifestPath).text();
  if (!/^\[lints\]\s*\r?\nworkspace\s*=\s*true\s*$/mu.test(manifest)) {
    violations.push(`${member}/Cargo.toml: missing '[lints] workspace = true'`);
  }
}

const clippy = Bun.spawnSync(
  [
    "cargo",
    "clippy",
    "--workspace",
    "--all-targets",
    "--all-features",
    "--message-format",
    "short",
  ],
  { cwd: workspaceRoot, stdout: "pipe", stderr: "pipe" },
);
const clippyOutput = `${new TextDecoder().decode(clippy.stdout)}\n${new TextDecoder().decode(clippy.stderr)}`;
await Bun.write(Bun.stdout, clippyOutput);
if (clippy.exitCode !== 0) {
  throw new Error(
    `cargo clippy exited with status ${String(clippy.exitCode)}.`,
  );
}
const inertPatterns = [
  "does not refer to a reachable function",
  "does not refer to a reachable type",
  "expected a function, found a",
  "expected a type, found a",
  "no item found",
  "unknown field",
];
for (const line of clippyOutput.split(/\r?\n/u)) {
  if (inertPatterns.some((pattern) => line.includes(pattern))) {
    violations.push(`clippy.toml has an inert ban: ${line.trim()}`);
  }
}

if (violations.length > 0) {
  throw new Error(
    `TaskNotes core quality checks failed:\n\n${violations.map((violation) => `- ${violation}`).join("\n")}`,
  );
}
await Bun.write(
  Bun.stdout,
  "TaskNotes core suppression and Clippy-configuration checks passed.\n",
);

async function workspaceMembers(): Promise<string[]> {
  const metadata = Bun.spawnSync(
    ["cargo", "metadata", "--no-deps", "--format-version", "1"],
    {
      cwd: workspaceRoot,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  if (metadata.exitCode !== 0) {
    throw new Error(
      `cargo metadata exited with status ${String(metadata.exitCode)}.`,
    );
  }
  const document: unknown = JSON.parse(
    new TextDecoder().decode(metadata.stdout),
  );
  if (
    typeof document !== "object" ||
    document === null ||
    !("packages" in document) ||
    !Array.isArray(document.packages)
  ) {
    throw new Error("cargo metadata did not return a packages array.");
  }
  const values: string[] = [];
  for (const entry of document.packages) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("manifest_path" in entry) ||
      typeof entry.manifest_path !== "string"
    ) {
      throw new Error("cargo metadata package is missing manifest_path.");
    }
    values.push(
      path
        .relative(workspaceRoot, path.dirname(entry.manifest_path))
        .replaceAll("\\", "/"),
    );
  }
  return values;
}
