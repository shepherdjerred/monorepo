import { expect, test } from "bun:test";
import { tmpdir } from "node:os";
import path from "node:path";

test("ContextBundle assembly performs no SQLite or Prisma write", async () => {
  const databasePath = path.join(
    tmpdir(),
    `birmel-context-bundle-${crypto.randomUUID()}.db`,
  );
  const sidecarPaths = [
    databasePath,
    `${databasePath}-shm`,
    `${databasePath}-wal`,
  ];

  for (const filePath of sidecarPaths) {
    expect(await Bun.file(filePath).exists()).toBe(false);
  }

  const child = Bun.spawn(
    [process.execPath, "run", "tests/context/no-database-write-fixture.ts"],
    {
      cwd: path.join(import.meta.dir, "../.."),
      env: {
        ...Bun.env,
        DATABASE_URL: `file:${databasePath}`,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  expect(exitCode, stderr).toBe(0);
  expect(stdout).toBe("1:3");
  for (const filePath of sidecarPaths) {
    expect(await Bun.file(filePath).exists()).toBe(false);
  }
});
