export async function command(
  argv: string[],
  input?: string,
  options: {
    cwd?: string;
    env?: Record<string, string | undefined>;
    progress?: boolean;
  } = {},
): Promise<string> {
  const child = Bun.spawn(argv, {
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    stdin: input === undefined ? "ignore" : new Blob([input]),
    stdout: "pipe",
    stderr: options.progress === true ? "inherit" : "pipe",
    env: {
      ...Bun.env,
      ...options.env,
      OP_SERVICE_ACCOUNT_TOKEN: undefined,
      MC_BRIDGE_TOKEN: undefined,
    },
  });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0)
    throw new Error(
      `${argv[0] ?? "Capture command"} failed (${code.toString()}): ${err.trim()}`,
    );
  return out;
}
export async function commandBytes(argv: string[]): Promise<Uint8Array> {
  const child = Bun.spawn(argv, {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...Bun.env,
      OP_SERVICE_ACCOUNT_TOKEN: undefined,
      MC_BRIDGE_TOKEN: undefined,
    },
  });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0)
    throw new Error(
      `${argv[0] ?? "Capture command"} failed (${code.toString()}): ${err.trim()}`,
    );
  return new Uint8Array(out);
}
