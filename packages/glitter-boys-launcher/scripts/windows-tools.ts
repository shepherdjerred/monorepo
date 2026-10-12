import path from "node:path";
import { readdir } from "node:fs/promises";
export async function powershell(): Promise<string> {
  const onPath = Bun.which("pwsh");
  if (onPath) return onPath;
  const programFiles = process.env["ProgramFiles"];
  if (!programFiles) throw new Error("ProgramFiles is unavailable");
  const regular = path.join(programFiles, "PowerShell", "7", "pwsh.exe");
  if (await Bun.file(regular).exists()) return regular;
  const apps = path.join(programFiles, "WindowsApps");
  const names = (await readdir(apps))
    .filter((n) => /^Microsoft\.PowerShell_.*_x64__/.test(n))
    .sort()
    .reverse();
  for (const name of names) {
    const executable = path.join(apps, name, "pwsh.exe");
    if (await Bun.file(executable).exists()) return executable;
  }
  throw new Error("Install PowerShell 7 before signing releases");
}
export async function run(args: string[], cwd: string): Promise<void> {
  const child = Bun.spawn(args, { cwd, stdout: "inherit", stderr: "inherit" });
  if ((await child.exited) !== 0)
    throw new Error(`${path.basename(args[0] ?? "Command")} failed`);
}
export async function signArtifact(root: string, file: string): Promise<void> {
  await run(
    [
      await powershell(),
      "-NoProfile",
      "-NonInteractive",
      "-File",
      path.join(root, "scripts", "sign-artifact.ps1"),
      "-Path",
      file,
    ],
    root,
  );
}
