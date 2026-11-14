import path from "node:path";

export type HistoryCliResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

/** Runs `toolkit history <args>` from source with extra environment. */
export async function runHistoryCli(
  args: readonly string[],
  env: Readonly<Record<string, string>>,
): Promise<HistoryCliResult> {
  const child = Bun.spawn(
    [process.execPath, "run", "src/index.ts", "history", ...args],
    {
      cwd: path.join(import.meta.dir, "../.."),
      env: { ...Bun.env, ...env },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}
