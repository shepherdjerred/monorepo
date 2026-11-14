/** Collect a child's piped output as it arrives; `text()` is everything read so far. */
export function collectOutput(stream: ReadableStream<Uint8Array>): {
  text: () => string;
  done: Promise<void>;
} {
  const decoder = new TextDecoder();
  let output = "";
  const done = (async () => {
    for await (const chunk of stream)
      output += decoder.decode(chunk, { stream: true });
  })();
  return { text: () => output, done };
}

/** Poll collected output until it contains `text`; fail if the child exits or the deadline passes first. */
export async function waitForLog(input: {
  output: () => string;
  text: string;
  child: Pick<Bun.Subprocess, "exitCode">;
  timeoutMs: number;
}): Promise<void> {
  const deadline = performance.now() + input.timeoutMs;
  while (!input.output().includes(input.text)) {
    if (input.child.exitCode !== null || performance.now() >= deadline)
      throw new Error(`Child never logged ${input.text}:\n${input.output()}`);
    await Bun.sleep(50);
  }
}
