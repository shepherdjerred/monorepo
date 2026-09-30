import { SANDBOX_MAX_PROCESSES } from "./process-limits.ts";

const processLimit = String(SANDBOX_MAX_PROCESSES);
const limiter = Bun.spawn({
  cmd: [
    "prlimit",
    `--pid=${String(process.pid)}`,
    `--nproc=${processLimit}:${processLimit}`,
  ],
  stdin: "ignore",
  stdout: "ignore",
  stderr: "pipe",
});
const [exitCode, stderr] = await Promise.all([
  limiter.exited,
  new Response(limiter.stderr).text(),
]);
if (exitCode !== 0) {
  throw new Error(
    `Failed to restrict Bun descendants (${String(exitCode)}): ${stderr}`,
  );
}
