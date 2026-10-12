import path from "node:path";
import { chmod, mkdir } from "node:fs/promises";
import { z } from "zod";
import { docker } from "@shepherdjerred/mc-harness/providers/docker/docker-cli.ts";
import type { ServerInfo } from "#e2e/harness/server.ts";
import { packageRoot } from "#e2e/harness/paths.ts";

/** Private native diagnostic recording; never capacity acceptance evidence. */
export async function recordFlight(
  server: ServerInfo,
  matchId: string,
  durationMs = 90_000,
) {
  if (server.kind !== "container")
    throw new Error("Flight recording requires Docker");
  const containerId = server.containerId;
  z.number().int().min(10_000).max(90_000).parse(durationMs);
  const exec = (...args: string[]) =>
    docker(["exec", "-u", "1000", server.containerId, ...args]);
  const began = Date.now();
  const since = (began / 1000).toFixed(3);
  const cpuBefore = await exec("cat", "/sys/fs/cgroup/cpu.stat");
  // The pinned image is a JRE; Minecraft owns the recording through its native command.
  const startReceipt = await exec("rcon-cli", "jfr start");
  if (!startReceipt.stdout.includes("JFR profiling started"))
    throw new Error("Minecraft refused the Flight recording start");
  const started = await logged("Started flight recorder profiling");
  const saved = /will dump to (?<file>debug\/\S+\.jfr) on exit/u.exec(started)
    ?.groups?.["file"];
  const remote = `/data/${z
    .string()
    .regex(/^debug\/[\w.-]+\.jfr$/u)
    .parse(saved)}`;
  let stopOutput: string;
  try {
    const until = Date.now() + durationMs;
    while (Date.now() < until)
      await Bun.sleep(Math.min(30_000, until - Date.now()));
  } finally {
    const stopReceipt = await exec("rcon-cli", "jfr stop");
    stopOutput = stopReceipt.stdout;
  }
  if (!stopOutput.includes("JFR profiling stopped and dumped to"))
    throw new Error("Minecraft did not acknowledge the Flight recording dump");
  const cpuAfter = await exec("cat", "/sys/fs/cgroup/cpu.stat");
  const out = path.join(packageRoot, ".cache/e2e/capacity/profiles", matchId);
  await mkdir(out, { recursive: true, mode: 0o700 });
  await docker([
    "cp",
    `${server.containerId}:${remote}`,
    path.join(out, "flight.jfr"),
  ]);
  await chmod(path.join(out, "flight.jfr"), 0o600);
  const process = Bun.spawn(
    ["mise", "exec", "--", "jfr", "summary", path.join(out, "flight.jfr")],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (code !== 0) throw new Error(`jfr summary failed: ${stderr}`);
  const summary = { stdout };
  if (!/storm\.BotThink\s+[1-9]\d*/u.test(summary.stdout))
    throw new Error("Flight recording contains no bot thinking spans");
  await Bun.write(path.join(out, "flight-summary.txt"), summary.stdout);
  await Bun.write(path.join(out, "cpu-before.txt"), cpuBefore.stdout);
  await Bun.write(path.join(out, "cpu-after.txt"), cpuAfter.stdout);
  await Bun.write(
    path.join(out, "profile.json"),
    JSON.stringify(
      {
        mode: "jfr",
        matchId,
        began,
        ended: Date.now(),
        durationMs,
        diagnosticOnly: true,
      },
      null,
      2,
    ),
  );
  console.warn(`Private Flight Recorder diagnostics: ${out}`);

  async function logged(text: string) {
    const deadline = Date.now() + 30_000;
    for (;;) {
      const logs = await docker(["logs", "--since", since, containerId]);
      const line = `${logs.stdout}\n${logs.stderr}`
        .split("\n")
        .find((entry) => entry.includes(text));
      if (line !== undefined) return line;
      if (Date.now() > deadline)
        throw new Error(`Missing JFR console receipt: ${text}`);
      await Bun.sleep(250);
    }
  }
}
