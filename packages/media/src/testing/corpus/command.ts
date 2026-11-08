import { spawn } from "node:child_process";

/** Only process transport is shared; CLI inputs and privacy assertions stay local. */
export async function runCorpusCommand(
  packageRoot: string,
  script: string,
  args: readonly string[],
) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn("bun", ["--no-install", script, ...args], {
        cwd: packageRoot,
        stdio: ["ignore", "pipe", "pipe"],
        signal: AbortSignal.timeout(3000),
      });
      let stdout = "",
        stderr = "";
      child.stdout.setEncoding("utf8").on("data", (value: string) => {
        stdout += value;
      });
      child.stderr.setEncoding("utf8").on("data", (value: string) => {
        stderr += value;
      });
      child.once("error", reject);
      child.once("close", (code) => {
        resolve({ code, stdout, stderr });
      });
    },
  );
}
