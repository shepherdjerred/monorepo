const cwd = import.meta.dir.replace(/\/src$/u, "");
const children = [
  Bun.spawn(["bun", "--watch", "src/server/index.ts"], {
    cwd,
    env: Bun.env,
    stdout: "inherit",
    stderr: "inherit",
  }),
  Bun.spawn(["vite"], {
    cwd,
    env: Bun.env,
    stdout: "inherit",
    stderr: "inherit",
  }),
];
async function shutdown() {
  for (const child of children) child.kill();
  await Promise.all(children.map((child) => child.exited));
}
process.once("SIGINT", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});
await Promise.race(children.map((child) => child.exited));
await shutdown();
