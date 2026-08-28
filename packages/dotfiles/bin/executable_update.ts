#!/usr/bin/env bun

export type Command = {
  readonly executable: string;
  readonly args: readonly string[];
};

export type RunCommand = (command: Command) => Promise<void>;

const isLinux = process.platform === "linux";

export async function run({ executable, args }: Command): Promise<void> {
  const prefix = `[${executable} ${args.join(" ")}]`;

  const proc = Bun.spawn([executable, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  await Promise.all([
    pipeThrough(prefix, proc.stdout, Bun.stdout),
    pipeThrough(prefix, proc.stderr, Bun.stderr),
  ]);

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`${prefix} exited with code ${exitCode.toString()}`);
  }
}

async function pipeThrough(
  prefix: string,
  readable: ReadableStream<Uint8Array>,
  writable: typeof Bun.stdout,
) {
  const decoder = new TextDecoder();
  for await (const chunk of readable) {
    const text = decoder.decode(chunk);
    await writable.write(new TextEncoder().encode(`${prefix} ${text}`));
  }
}

// Sequential commands (must run in order)
const sequentialCommands: Command[] = [
  { executable: "chezmoi", args: ["update"] },
  ...(isLinux
    ? [
        { executable: "sudo", args: ["apt", "update"] },
        { executable: "sudo", args: ["apt", "upgrade", "-y"] },
        { executable: "sudo", args: ["apt", "autoremove", "-y"] },
      ]
    : []),
];

// Parallel commands (can run concurrently)
const parallelCommands: Command[] = [
  { executable: "mise", args: ["upgrade"] },
  { executable: "fish", args: ["-c", "fisher update"] },
  { executable: "fish", args: ["-c", "fish_update_completions"] },
  { executable: "nvim", args: ["--headless", "+Lazy! sync", "+qa"] },
];

// Sequential command chains (each array runs in order)
async function updateBrew(runCommand: RunCommand): Promise<void> {
  await runCommand({ executable: "brew", args: ["update"] });
  await runCommand({ executable: "brew", args: ["upgrade"] });
}

export async function main(runCommand: RunCommand = run): Promise<void> {
  // Run sequential commands first
  for (const cmd of sequentialCommands) {
    await runCommand(cmd);
  }

  // Run parallel commands (including chains that are internally sequential)
  await Promise.all([
    ...parallelCommands.map((command) => runCommand(command)),
    updateBrew(runCommand),
  ]);

  // Export current brew state
  const home = Bun.env["HOME"];
  if (home === undefined) throw new Error("HOME is required");
  await runCommand({
    executable: "bash",
    args: [`${home}/bin/write_brewfile.sh`],
  });
}

if (import.meta.main) await main();
