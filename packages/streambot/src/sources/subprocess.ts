export type SubprocessResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
};

/** Run a piped subprocess while draining both output streams concurrently. */
export async function runSubprocess(
  command: string[],
  signal: AbortSignal,
  onLine?: (line: string) => void,
): Promise<SubprocessResult> {
  const proc = Bun.spawn(command, {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    signal,
  });
  const output = await Promise.all([
    onLine === undefined
      ? new Response(proc.stdout).text()
      : readLines(proc.stdout, onLine),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return {
    stdout: output[0],
    stderr: output[1],
    exitCode: output[2],
  };
}

async function readLines(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<string> {
  let pending = "";
  const decoder = new TextDecoder();
  for await (const chunk of stream) {
    pending += decoder.decode(chunk, { stream: true });
    let newline = pending.indexOf("\n");
    while (newline >= 0) {
      onLine(pending.slice(0, newline));
      pending = pending.slice(newline + 1);
      newline = pending.indexOf("\n");
    }
  }
  pending += decoder.decode();
  if (pending !== "") onLine(pending);
  return "";
}
