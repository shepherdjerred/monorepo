import { join } from "node:path";
import { mkdir, mkdtemp, copyFile } from "node:fs/promises";
const root = join(import.meta.dir, "..");
async function run(args: string[]) {
  // Maven is a batch launcher on Windows; cmd owns that one fixed command.
  const command =
    process.platform === "win32" && args[0] === "mvn"
      ? ["cmd.exe", "/d", "/c", "mvn.cmd", ...args.slice(1)]
      : args;
  const p = Bun.spawn(command, {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await p.exited) !== 0) throw new Error(`Failed: ${args[0]}`);
}
await run(["mvn", "package"]);
const jar = "castle-casters-1.0.0-SNAPSHOT-jar-with-dependencies.jar";
if (Bun.argv.includes("--run")) {
  await run([
    "java",
    ...(process.platform === "darwin" ? ["-XstartOnFirstThread"] : []),
    "--enable-native-access=ALL-UNNAMED",
    "-jar",
    join(root, "target", jar),
  ]);
} else {
  if (!(
    (process.platform === "darwin" && process.arch === "arm64") ||
    (process.platform === "win32" && process.arch === "x64")
  ))
    throw new Error(
      "Desktop bundles require macOS arm64 or Windows x64 on the target OS",
    );
  const directory = join(root, "target", "desktop");
  await mkdir(directory, { recursive: true });
  const build = await mkdtemp(join(directory, "build-"));
  const input = join(build, "input");
  await mkdir(input);
  await copyFile(join(root, "target", jar), join(input, jar));
  await run([
    "jpackage",
    "--type",
    "app-image",
    "--name",
    "Castle Casters",
    "--app-version",
    "1.0.0",
    "--input",
    input,
    "--main-jar",
    jar,
    "--main-class",
    "com.shepherdjerred.castlecasters.Main",
    "--dest",
    build,
    "--add-modules",
    "java.base,java.desktop,java.logging,java.management,java.naming,jdk.unsupported,jdk.crypto.ec",
    "--java-options",
    "--enable-native-access=ALL-UNNAMED",
    ...(process.platform === "darwin"
      ? ["--java-options", "-XstartOnFirstThread"]
      : []),
  ]);
  const app = join(
    build,
    process.platform === "darwin" ? "Castle Casters.app" : "Castle Casters",
  );
  const zip = join(
    build,
    `castle-casters-${process.platform}-${process.arch}.zip`,
  );
  if (process.platform === "darwin")
    await run(["ditto", "-c", "-k", "--keepParent", app, zip]);
  else
    await run([
      "powershell.exe",
      "-NoProfile",
      "-File",
      join(import.meta.dir, "zip.ps1"),
      "-InputPath",
      app,
      "-OutputPath",
      zip,
    ]);
  console.log(`Desktop image: ${app}\nArchive: ${zip}`);
}
