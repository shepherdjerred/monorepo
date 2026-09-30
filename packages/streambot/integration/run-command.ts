/**
 * Run a command to completion, failing loudly with its stderr.
 *
 * Shared by the integration suites because both drive real ffmpeg/ffprobe and both need the same
 * thing from a failure: the exit code and enough stderr to say what ffmpeg objected to. A silent
 * non-zero exit here would surface later as a confusing assertion on a fixture that was never
 * built, which is the hardest kind of integration failure to read.
 */
export async function runCommand(cmd: string[]): Promise<void> {
  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [stderr, code] = await Promise.all([
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(
      `command failed (${String(code)}): ${cmd.join(" ")}\n${stderr.trim().slice(-800)}`,
    );
  }
}
