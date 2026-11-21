// `--fixture` swaps the real API for the in-memory fixture server, which needs
// no database, credentials, Grafana or Prometheus. Vite's proxy is unchanged.
const fixture = Bun.argv.includes("--fixture");
if (fixture) Bun.env["OPS_FIXTURE"] ??= "volume";
const vitePort = Number(Bun.env["PORT"] ?? "7342");
const apiPort =
  Bun.env["API_PORT"] ??
  (Bun.env["PORT"] === undefined ? "7341" : String(vitePort + 1));
const baseEnv: Record<string, string | undefined> = Object.fromEntries(
  Object.entries(Bun.env).flatMap(([key, value]) =>
    typeof value === "string" ? [[key, value]] : [],
  ),
);
const apiEnv: Record<string, string | undefined> = {
  ...baseEnv,
  PORT: apiPort,
};
const viteEnv: Record<string, string | undefined> = {
  ...baseEnv,
  API_PORT: apiPort,
};
const api = Bun.spawn(
  fixture
    ? ["bun", "e2e/server.ts", apiPort]
    : ["bun", "run", "src/server/index.ts"],
  {
    cwd: import.meta.dir.replace(/\/src$/u, ""),
    env: apiEnv,
    stdout: "inherit",
    stderr: "inherit",
  },
);
const vite = Bun.spawn(["vite"], {
  cwd: import.meta.dir.replace(/\/src$/u, ""),
  env: viteEnv,
  stdout: "inherit",
  stderr: "inherit",
});

const stop = { requested: false };
async function shutdown(): Promise<void> {
  stop.requested = true;
  api.kill();
  vite.kill();
  await Promise.all([api.exited, vite.exited]);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
const exitCode = await Promise.race([api.exited, vite.exited]);
// A fixture server that refuses to start (an unknown `OPS_FIXTURE`) fails the
// command instead of ending it quietly.
if (fixture && !stop.requested) process.exitCode = exitCode;
await shutdown();
