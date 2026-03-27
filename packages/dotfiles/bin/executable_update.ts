#!/usr/bin/env bun

import * as R from "remeda";

type Command = {
  executable: string;
  args: string[];
};

const isLinux = process.platform === "linux";
const isMac = process.platform === "darwin";

async function run({ executable, args }: Command) {
  const prefix = `[${executable} ${args.join(" ")}]`;

  const proc = Bun.spawn([executable, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  await Promise.all([
    pipeThrough(prefix, proc.stdout, Bun.stdout),
    pipeThrough(prefix, proc.stderr, Bun.stderr),
  ]);

  await proc.exited;
}

async function pipeThrough(
  prefix: string,
  readable: ReadableStream<Uint8Array>,
  writable: typeof Bun.stdout,
) {
  const decoder = new TextDecoder();
  for await (const chunk of readable) {
    const text = decoder.decode(chunk);
    writable.write(new TextEncoder().encode(`${prefix} ${text}`));
  }
}

// Sequential commands (must run in order)
const sequentialCommands: Command[] = [
  { executable: "chezmoi", args: ["update"] },
  { executable: "chezmoi", args: ["apply"] },
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
async function updateBrew() {
  await run({ executable: "brew", args: ["update"] });
  await run({ executable: "brew", args: ["upgrade"] });
}

// Run sequential commands first
for (const cmd of sequentialCommands) {
  await run(cmd);
}

// Run parallel commands (including chains that are internally sequential)
await Promise.all([...R.pipe(parallelCommands, R.map(run)), updateBrew()]);

// Export current brew state
await run({
  executable: "bash",
  args: [`${process.env.HOME}/bin/write_brewfile.sh`],
});
