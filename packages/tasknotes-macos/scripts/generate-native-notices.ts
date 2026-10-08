import { dirname, join, resolve, sep } from "node:path";
import { realpath } from "node:fs/promises";

const root = resolve(import.meta.dir, "../../..");
const core = join(root, "packages/tasknotes-core");
const mac = join(root, "packages/tasknotes-macos");

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Invalid native dependency metadata object.");
  return value;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value))
    throw new Error("Invalid native dependency metadata array.");
  return value;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value)
    throw new Error("Missing native dependency metadata string.");
  return value;
}

const arguments_ = process.argv.slice(2);
let platform = "macos";
let outputDirectory: string | undefined;
for (let index = 0; index < arguments_.length; index++) {
  const argument = arguments_[index];
  if (argument === "--ios") platform = "ios";
  else if (argument === "--platform") platform = text(arguments_[++index]);
  else if (argument === "--output-dir")
    outputDirectory = resolve(root, text(arguments_[++index]));
  else throw new Error(`Unknown native notice argument: ${argument}.`);
}
const platformTargets: Record<string, string[]> = {
  macos: ["aarch64-apple-darwin", "x86_64-apple-darwin"],
  ios: ["aarch64-apple-ios", "aarch64-apple-ios-sim", "x86_64-apple-ios"],
  android: ["aarch64-linux-android", "x86_64-linux-android"],
  windows: ["x86_64-pc-windows-msvc"],
};
const targets = platformTargets[platform];
if (!targets)
  throw new Error(`Unsupported native notice platform: ${platform}.`);
if ((platform === "windows" || platform === "android") && !outputDirectory)
  throw new Error(
    "Portable native notices require an explicit output directory.",
  );
async function sourceInputs(): Promise<Record<string, string>> {
  const files = new Set([
    "LICENSE",
    "packages/tasknotes-core/Cargo.lock",
    "packages/tasknotes-macos/scripts/generate-native-notices.ts",
  ]);
  for (const pattern of [
    "Cargo.toml",
    "crates/**/Cargo.toml",
    "xtask/Cargo.toml",
  ]) {
    for await (const file of new Bun.Glob(pattern).scan({
      cwd: core,
      onlyFiles: true,
    }))
      files.add(`packages/tasknotes-core/${file}`);
  }
  for await (const file of new Bun.Glob("**/*").scan({
    cwd: join(import.meta.dir, "license-texts"),
    onlyFiles: true,
  }))
    files.add(`packages/tasknotes-macos/scripts/license-texts/${file}`);
  if (platform === "macos") {
    files.add("packages/tasknotes-macos/Package.swift");
    files.add("packages/tasknotes-macos/Package.resolved");
  }
  const result: Record<string, string> = {};
  for (const file of [...files].sort())
    result[file] = new Bun.CryptoHasher("sha256")
      .update(await Bun.file(join(root, file)).arrayBuffer())
      .digest("hex");
  return result;
}
const inputs = await sourceInputs();
const graphs: Record<string, unknown>[] = [];
for (const target of targets) {
  const cargo = Bun.spawn(
    [
      "cargo",
      "metadata",
      "--locked",
      "--format-version",
      "1",
      "--filter-platform",
      target,
    ],
    { cwd: core, stdout: "pipe", stderr: "inherit" },
  );
  const graph = record(JSON.parse(await new Response(cargo.stdout).text()));
  if ((await cargo.exited) !== 0)
    throw new Error("Locked Cargo dependency inventory failed.");
  graphs.push(graph);
}
const metadata = graphs[0];
if (!metadata) throw new Error("Native target dependency graph is missing.");
const packages = array(metadata["packages"]).map(record);
const nodes = graphs.flatMap((graph) =>
  array(record(graph["resolve"])["nodes"]).map(record),
);
const ffi = packages.find((item) => item["name"] === "tasknotes-core-ffi");
if (!ffi) throw new Error("Native FFI dependency root is missing.");
const pending = [text(ffi["id"])];
const reached = new Set<string>();
while (pending.length) {
  const id = pending.pop();
  if (!id || reached.has(id)) continue;
  reached.add(id);
  const matching = nodes.filter((item) => item["id"] === id);
  if (!matching.length)
    throw new Error("Native dependency graph is incomplete.");
  for (const edge of matching.flatMap((node) =>
    array(node["deps"]).map(record),
  )) {
    if (
      array(edge["dep_kinds"])
        .map(record)
        .some((kind) => kind["kind"] === null || kind["kind"] === "build")
    )
      pending.push(text(edge["pkg"]));
  }
}
const sections = [
  "Facet native third-party notices\nGenerated from the locked native dependency graph.\n",
];
const inventory: {
  name: string;
  version: string;
  license: string;
  files: string[];
  missingPackageText?: boolean;
  repository?: string;
  revision?: string;
  licenseTextSHA256?: string;
}[] = [];
const licenseCatalog = record(
  await Bun.file(join(import.meta.dir, "license-texts/sources.json")).json(),
);
for (const dependency of packages
  .filter((item) => reached.has(text(item["id"])) && item["source"] !== null)
  .sort((a, b) => text(a["name"]).localeCompare(text(b["name"])))) {
  const directory = dirname(text(dependency["manifest_path"]));
  const files = new Set<string>();
  const explicit = dependency["license_file"];
  if (typeof explicit === "string") files.add(explicit);
  for await (const file of new Bun.Glob(
    "{LICENSE,license,License,COPYING,NOTICE}*",
  ).scan({ cwd: directory, onlyFiles: true }))
    files.add(file);
  const name = text(dependency["name"]);
  const version = text(dependency["version"]);
  const license =
    typeof dependency["license"] === "string"
      ? dependency["license"]
      : "license-file";
  sections.push(`\n===== ${name} ${version} (${license}) =====\n`);
  if (!files.size) {
    const vcsFile = Bun.file(join(directory, ".cargo_vcs_info.json"));
    if (!(await vcsFile.exists()))
      throw new Error(
        `Native dependency ${name} ${version} has neither a license text nor a verified source revision.`,
      );
    const revision = text(record(record(await vcsFile.json())["git"])["sha1"]);
    const repository = text(dependency["repository"])
      .replace(/\.git$/, "")
      .replace(/\/$/, "");
    if (
      !/^[a-f0-9]{40}$/.test(revision) ||
      !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(repository)
    )
      throw new Error(
        `Native dependency ${name} has no supported immutable license source.`,
      );
    if (!licenseCatalog[license])
      throw new Error(
        `Native dependency ${name} ${version} omits its license text and has no checked-in canonical ${license} asset.`,
      );
    const canonical = record(licenseCatalog[license]);
    const filename = text(canonical["file"]);
    if (!/^[\w.-]+\.txt$/.test(filename))
      throw new Error("Invalid canonical license asset path.");
    const data = await Bun.file(
      join(import.meta.dir, "license-texts", filename),
    ).arrayBuffer();
    const hash = new Bun.CryptoHasher("sha256").update(data).digest("hex");
    if (hash !== canonical["sha256"])
      throw new Error(`Canonical license text changed: ${license}.`);
    const source = text(canonical["source"]);
    sections.push(
      `\nDeclared package license: ${license}. Package omits license text.\nSource revision: ${repository}/tree/${revision}\nCanonical license text: ${source}\n${new TextDecoder().decode(data)}\n`,
    );
    inventory.push({
      name,
      version,
      license,
      files: [source],
      missingPackageText: true,
      repository,
      revision,
      licenseTextSHA256: hash,
    });
    continue;
  }
  const normalizedRoot = await realpath(directory);
  for (const file of [...files].sort()) {
    const path = await realpath(resolve(directory, file));
    if (!path.startsWith(normalizedRoot + sep))
      throw new Error(`License path escapes native dependency ${name}.`);
    sections.push(`\n--- ${file} ---\n${await Bun.file(path).text()}\n`);
  }
  inventory.push({ name, version, license, files: [...files].sort() });
}
if (platform === "macos") {
  const license = join(mac, ".build/checkouts/KeyboardShortcuts/license");
  if (!(await Bun.file(license).exists()))
    throw new Error(
      "Run swift package resolve before generating macOS notices.",
    );
  const resolved = record(await Bun.file(join(mac, "Package.resolved")).json());
  const shortcut = array(resolved["pins"])
    .map(record)
    .find((item) => item["identity"] === "keyboardshortcuts");
  if (!shortcut)
    throw new Error(
      "KeyboardShortcuts is missing from the locked Swift package inventory.",
    );
  const version = text(record(shortcut["state"])["version"]);
  sections.push(
    `\n===== KeyboardShortcuts ${version} (MIT) =====\n${await Bun.file(license).text()}\n`,
  );
  inventory.push({
    name: "KeyboardShortcuts",
    version,
    license: "MIT",
    files: ["license"],
  });
}
const destination = outputDirectory ?? join(mac, "Resources", platform);
if (JSON.stringify(inputs) !== JSON.stringify(await sourceInputs()))
  throw new Error(
    "Native notice source inputs changed during generation; retry at a stable producer checkpoint.",
  );
await Bun.write(join(destination, "ThirdPartyNotices.txt"), sections.join(""));
await Bun.write(
  join(destination, "FirstPartyLicense.txt"),
  await Bun.file(join(root, "LICENSE")).arrayBuffer(),
);
const inventoryPath = outputDirectory
  ? join(destination, "native-license-inventory.json")
  : join(mac, `.build/native-license-inventory-${platform}.json`);
const inventoryJSON = JSON.stringify(
  {
    schemaVersion: 1,
    platform,
    targets,
    sourceInputs: inputs,
    dependencies: inventory,
  },
  null,
  2,
);
await Bun.write(inventoryPath, inventoryJSON);
if (!outputDirectory)
  await Bun.write(
    join(destination, "native-license-inventory.json"),
    inventoryJSON,
  );
console.log(
  `Generated native notices for ${inventory.length} locked dependencies.`,
);
