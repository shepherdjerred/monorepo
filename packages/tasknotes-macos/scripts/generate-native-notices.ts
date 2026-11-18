import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");
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

export interface NativeNoticeOptions {
  readonly platform?: string;
  readonly outputDirectory?: string;
  readonly repoRoot?: string;
}

const platformTargets: Record<string, string[]> = {
  macos: ["aarch64-apple-darwin", "x86_64-apple-darwin"],
  ios: ["aarch64-apple-ios", "aarch64-apple-ios-sim", "x86_64-apple-ios"],
  android: ["aarch64-linux-android", "x86_64-linux-android"],
  windows: ["x86_64-pc-windows-msvc"],
};

export function parseNoticeArguments(
  arguments_: readonly string[],
  repoRoot = root,
): { platform: string; outputDirectory?: string } {
  let platform = "macos";
  let outputDirectory: string | undefined;
  for (let index = 0; index < arguments_.length; index++) {
    const argument = arguments_[index];
    if (argument === "--ios") platform = "ios";
    else if (argument === "--platform") platform = text(arguments_[++index]);
    else if (argument === "--output-dir")
      outputDirectory = resolve(repoRoot, text(arguments_[++index]));
    else throw new Error(`Unknown native notice argument: ${argument}.`);
  }
  if (!platformTargets[platform])
    throw new Error(`Unsupported native notice platform: ${platform}.`);
  if ((platform === "windows" || platform === "android") && !outputDirectory)
    throw new Error(
      "Portable native notices require an explicit output directory.",
    );
  return outputDirectory === undefined
    ? { platform }
    : { platform, outputDirectory };
}

async function sourceInputs(
  platform: string,
  repoRoot: string,
): Promise<Record<string, string>> {
  const files = new Set([
    "LICENSE",
    "packages/tasknotes-macos/scripts/generate-native-notices.ts",
  ]);
  if (platform === "macos") {
    files.add("packages/tasknotes-macos/Package.swift");
    files.add("packages/tasknotes-macos/Package.resolved");
  }
  const result: Record<string, string> = {};
  for (const file of [...files].sort()) {
    result[file] = new Bun.CryptoHasher("sha256")
      .update(await Bun.file(join(repoRoot, file)).arrayBuffer())
      .digest("hex");
  }
  return result;
}

export async function generateNativeNotices(
  options: NativeNoticeOptions = {},
): Promise<{ count: number; destination: string }> {
  const repoRoot = options.repoRoot ?? root;
  const macRoot = join(repoRoot, "packages/tasknotes-macos");
  const platform = options.platform ?? "macos";
  const targets = platformTargets[platform];
  if (!targets)
    throw new Error(`Unsupported native notice platform: ${platform}.`);
  if (
    (platform === "windows" || platform === "android") &&
    options.outputDirectory === undefined
  ) {
    throw new Error(
      "Portable native notices require an explicit output directory.",
    );
  }

  if (platform === "macos") {
    const licenseFile = Bun.file(
      join(macRoot, ".build/checkouts/KeyboardShortcuts/license"),
    );
    if (!(await licenseFile.exists()) && Bun.which("swift") !== null) {
      const resolveChild = Bun.spawn(["swift", "package", "resolve"], {
        cwd: macRoot,
        stdout: "ignore",
        stderr: "inherit",
      });
      if ((await resolveChild.exited) !== 0) {
        throw new Error(
          "swift package resolve failed before notice generation.",
        );
      }
    }
  }

  const inputs = await sourceInputs(platform, repoRoot);
  const sections = [
    "Facet native third-party notices\nGenerated from the locked native dependency graph.\n",
  ];
  const inventory: {
    name: string;
    version: string;
    license: string;
    files: string[];
  }[] = [];

  if (platform === "macos") {
    const license = join(macRoot, ".build/checkouts/KeyboardShortcuts/license");
    if (!(await Bun.file(license).exists())) {
      throw new Error(
        "Run swift package resolve before generating macOS notices.",
      );
    }
    const resolved = record(
      await Bun.file(join(macRoot, "Package.resolved")).json(),
    );
    const shortcut = array(resolved["pins"])
      .map(record)
      .find((item) => item["identity"] === "keyboardshortcuts");
    if (!shortcut) {
      throw new Error(
        "KeyboardShortcuts is missing from the locked Swift package inventory.",
      );
    }
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
  } else {
    sections.push(
      "\nNo third-party native libraries are linked into this platform target.\n",
    );
  }

  const destination =
    options.outputDirectory ?? join(macRoot, "Resources", platform);
  if (
    JSON.stringify(inputs) !==
    JSON.stringify(await sourceInputs(platform, repoRoot))
  ) {
    throw new Error(
      "Native notice source inputs changed during generation; retry at a stable producer checkpoint.",
    );
  }
  await Bun.write(
    join(destination, "ThirdPartyNotices.txt"),
    sections.join(""),
  );
  await Bun.write(
    join(destination, "FirstPartyLicense.txt"),
    await Bun.file(join(repoRoot, "LICENSE")).arrayBuffer(),
  );
  const inventoryPath = options.outputDirectory
    ? join(destination, "native-license-inventory.json")
    : join(macRoot, `.build/native-license-inventory-${platform}.json`);
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
  if (!options.outputDirectory) {
    await Bun.write(
      join(destination, "native-license-inventory.json"),
      inventoryJSON,
    );
  }
  return { count: inventory.length, destination };
}

if (import.meta.main) {
  const parsed = parseNoticeArguments(process.argv.slice(2));
  const result = await generateNativeNotices(parsed);
  console.log(
    `Generated native notices for ${String(result.count)} locked dependencies in ${mac && result.destination}.`,
  );
}
