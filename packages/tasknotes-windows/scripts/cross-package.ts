import path from "node:path";

// Builds every Windows project, the app's MSIX, and the standalone unpackaged
// win-x64 executable on Linux in the pinned windows-cross-compiler-winui image.
const packageRoot = path.resolve(import.meta.dir, "..");
const repositoryRoot = path.resolve(packageRoot, "..", "..");
const digestFile = path.join(
  repositoryRoot,
  "packages",
  "windows-cross-compiler",
  "images",
  "windows-cross-compiler-winui",
  "DIGEST",
);
const digestSource = Bun.file(digestFile);
if (!(await digestSource.exists())) {
  throw new Error(
    `${digestFile} is missing; the windows-cross-compiler-winui image has not been pinned yet.`,
  );
}
const digestText = await digestSource.text();
const digest = digestText.trim();
if (!/^sha256:[\da-f]{64}$/u.test(digest)) {
  throw new Error(`${digestFile} does not hold a canonical image digest.`);
}
const image = `docker.io/shepherdjerred/windows-cross-compiler-winui@${digest}`;

const workdir = "/workspace/packages/tasknotes-windows";

const child = Bun.spawn(
  [
    "docker",
    "run",
    "--rm",
    "--platform",
    "linux/amd64",
    "--volume",
    `${repositoryRoot}:/workspace`,
    "--volume",
    "tasknotes-windows-cross-nuget:/root/.nuget/packages",
    "--workdir",
    workdir,
    image,
    "scripts/cross-build.sh",
  ],
  { stdin: "inherit", stdout: "inherit", stderr: "inherit" },
);
const exitCode = await child.exited;
if (exitCode !== 0) {
  process.exit(exitCode);
}

const outputDirectory = path.join(packageRoot, "AppPackages", "cross");
const packages = await Array.fromAsync(
  new Bun.Glob("**/TaskNotes.Windows.App_*.msix").scan({
    cwd: outputDirectory,
    onlyFiles: true,
  }),
);
const [appPackage] = packages;
if (appPackage === undefined) {
  throw new Error(`No TaskNotes MSIX was produced in ${outputDirectory}.`);
}

const standaloneExe = path.join(
  packageRoot,
  "AppPackages",
  "win-x64-standalone",
  "TaskNotes.Windows.App.exe",
);
if (!(await Bun.file(standaloneExe).exists())) {
  throw new Error(
    `Standalone executable was not produced at ${standaloneExe}.`,
  );
}

await Bun.write(
  Bun.stdout,
  `${path.join(outputDirectory, appPackage)}\n${standaloneExe}\n`,
);
