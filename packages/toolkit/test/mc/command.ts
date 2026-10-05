import path from "node:path";

const entry = path.resolve(import.meta.dirname, "../../src/index.ts");

export async function runMcCommand(args: string[]) {
  const child = Bun.spawn([process.execPath, "run", entry, "mc", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...Bun.env,
      HOME: "/nonexistent-toolkit-mc-test",
      TOOLKIT_MC_NO_AUTOSTART: "1",
    },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}
