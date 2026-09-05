export async function kubectlExecInPod(input: {
  namespace: string;
  container: string;
  pod: string;
  command: string | readonly string[];
}): Promise<string> {
  const command =
    typeof input.command === "string"
      ? { args: ["sh", "-c", input.command], label: input.command }
      : { args: [...input.command], label: input.command.join(" ") };
  const args = [
    "kubectl",
    "exec",
    "--namespace",
    input.namespace,
    "--container",
    input.container,
    input.pod,
    "--",
    ...command.args,
  ];
  const proc = Bun.spawn(args, {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    const detail = stderr.trim() || stdout.trim() || "(no output)";
    throw new Error(
      `kubectl exec [${command.label}] in ${input.namespace}/${input.pod} exited ${String(exitCode)}: ${detail}`,
    );
  }
  return stdout;
}
