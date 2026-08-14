import path from "node:path";

const packageRoot = path.resolve(import.meta.dir, "..");
const passive = Bun.argv.includes("--check");
const unknown = Bun.argv.slice(2).filter((argument) => argument !== "--check");
if (unknown.length > 0) {
  throw new Error(`Unknown XAML formatting arguments: ${unknown.join(", ")}`);
}

const sourceRoots = [
  "src/TaskNotes.Windows.App",
  "tests/TaskNotes.Windows.App.Tests",
] as const;
const files: string[] = [];
for (const sourceRoot of sourceRoots) {
  const glob = new Bun.Glob("**/*.xaml");
  for await (const file of glob.scan({
    cwd: path.join(packageRoot, sourceRoot),
    onlyFiles: true,
  })) {
    const normalized = file.split(path.sep).join("/");
    if (
      normalized.startsWith("bin/") ||
      normalized.includes("/bin/") ||
      normalized.startsWith("obj/") ||
      normalized.includes("/obj/")
    ) {
      continue;
    }
    files.push(`${sourceRoot}/${normalized}`);
  }
}

files.sort((left, right) => left.localeCompare(right));
if (files.length === 0) {
  throw new Error("No handwritten TaskNotes Windows XAML files were found.");
}

const child = Bun.spawn(
  [
    process.execPath,
    "scripts/dotnet.ts",
    "xstyler",
    "--file",
    files.join(","),
    ...(passive ? ["--passive"] : []),
    "--loglevel",
    "Minimal",
  ],
  {
    cwd: packageRoot,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  },
);
process.exit(await child.exited);
