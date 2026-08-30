export async function readPipedProcess(
  child: {
    readonly exited: Promise<number>;
    readonly stdout: ReadableStream<Uint8Array>;
    readonly stderr: ReadableStream<Uint8Array>;
  },
  failurePrefix: string,
): Promise<string> {
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`${failurePrefix}: ${stderr.trim()}`);
  }
  return stdout;
}
