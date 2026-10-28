import { expect, test } from "vitest";
import path from "node:path";

test("real ffmpeg, demux, and paced audio/video survive playback, seeking, and repeated stops", async () => {
  const child = Bun.spawn(
    [process.execPath, path.resolve("test/fixtures/playback-smoke.ts")],
    {
      stdout: "pipe",
      stderr: "pipe",
      signal: AbortSignal.timeout(85_000),
    },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(exitCode, `${stdout}\n${stderr}`).toBe(0);
  expect(stdout).toContain('"scenario":"avcc-copy"');
  expect(stdout).toContain('"scenario":"software-transcode"');
  expect(stdout).toContain('"scenario":"seek-stop-3"');
}, 90_000);
