export async function runPhp(
  args: readonly string[],
  cwd = "/app/forum",
  timeoutMs = 90_000,
): Promise<void> {
  const command =
    args[0] === "cmd.php"
      ? ["/opt/storm-forum/runtime/command.php", ...args.slice(1)]
      : args;
  const child = Bun.spawn(["php", ...command], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    timeout: timeoutMs,
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (
    code !== 0 ||
    /An exception occurred:|Fatal error:|An unexpected error occurred|Command .* is not defined/.test(
      stdout + stderr,
    )
  ) {
    // Native exception messages can contain DSNs. Expose only operation and status.
    throw new Error(
      `PHP operation ${args[0] ?? "unknown"} failed (${String(code)}); captured ${String(stdout.length + stderr.length)} diagnostic bytes`,
    );
  }
}
