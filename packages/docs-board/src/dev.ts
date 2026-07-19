const cwd = new URL("..", import.meta.url).pathname;
const api = Bun.spawn(["bun", "run", "src/server/index.ts"], {
  cwd,
  stdout: "inherit",
  stderr: "inherit",
});
const web = Bun.spawn(["bunx", "vite", "--open"], {
  cwd,
  stdout: "inherit",
  stderr: "inherit",
});

const exitCode = await Promise.race([api.exited, web.exited]);
api.kill();
web.kill();
process.exit(exitCode);
