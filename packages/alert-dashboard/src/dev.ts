const api = Bun.spawn(["bun", "run", "src/server/index.ts"], {
  cwd: import.meta.dir.replace(/\/src$/u, ""),
  env: Bun.env,
  stdout: "inherit",
  stderr: "inherit",
});
const vite = Bun.spawn(["vite"], {
  cwd: import.meta.dir.replace(/\/src$/u, ""),
  env: Bun.env,
  stdout: "inherit",
  stderr: "inherit",
});

async function shutdown(): Promise<void> {
  api.kill();
  vite.kill();
  await Promise.all([api.exited, vite.exited]);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
await Promise.race([api.exited, vite.exited]);
await shutdown();
