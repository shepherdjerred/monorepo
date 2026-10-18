/** Shared subprocess boundary for task-owned, disposable admission proofs. */
export async function admissionProcessResult(
  command: string[],
  input?: unknown,
) {
  const child = Bun.spawn(command, {
    stdin: input === undefined ? "ignore" : new Blob([JSON.stringify(input)]),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...Bun.env, OP_SERVICE_ACCOUNT_TOKEN: undefined },
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr };
}
