const packageRoot = import.meta.dir.replace(/\/scripts$/u, "");
const sourceFiles = new Set<string>();

for (const pattern of ["src/**/*.ts", "src/**/*.tsx"]) {
  for await (const sourceFile of new Bun.Glob(pattern).scan(packageRoot)) {
    sourceFiles.add(sourceFile);
  }
}

const sortedSourceFiles = [...sourceFiles].sort();
if (sortedSourceFiles.length === 0) {
  throw new Error("dependency-cruiser received no TypeScript source files");
}

const dependencyCruiser = Bun.spawn(
  [
    "depcruise",
    ...sortedSourceFiles,
    "--config",
    "dependency-cruiser.config.cjs",
  ],
  {
    cwd: packageRoot,
    stdout: "inherit",
    stderr: "inherit",
  },
);

const exitCode = await dependencyCruiser.exited;
if (exitCode !== 0) {
  process.exitCode = exitCode;
}
