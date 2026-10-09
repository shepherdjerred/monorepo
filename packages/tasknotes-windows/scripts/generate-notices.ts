import path from "node:path";

const packageRoot = path.resolve(import.meta.dir, "..");
// NuGet notices need the complete locked Windows application graph, including
// SDK/build-tool license provenance. A portable build cannot produce that graph.
for (const command of [
  [
    process.execPath,
    "scripts/dotnet.ts",
    "restore",
    "src/TaskNotes.Windows.App/TaskNotes.Windows.App.csproj",
    "--locked-mode",
    "--property:EnableWindowsTargeting=true",
  ],
  [process.execPath, "scripts/prepare-notices.ts"],
]) {
  const child = Bun.spawn(command, {
    cwd: packageRoot,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await child.exited) !== 0)
    throw new Error(
      "Locked Facet notice generation failed; consumers must not use missing or stale notices.",
    );
}
