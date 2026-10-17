import { expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";

test("theme test hashes follow their external docs and inherited CI runner", async () => {
  const repository = path.join(import.meta.dir, "../..");
  const fixture = await mkdtemp(path.join(tmpdir(), "theme-cache-inputs-"));
  const Summary = z.object({
    tasks: z.array(z.object({ taskId: z.string(), hash: z.string() })),
  });
  const hashes = () => {
    const result = Bun.spawnSync(
      [
        path.join(repository, "node_modules/.bin/turbo"),
        "run",
        "test",
        "test:ci",
        "--filter=@shepherdjerred/storm-theme",
        "--dry=json",
      ],
      { cwd: fixture, env: { ...Bun.env, TURBO_TELEMETRY_DISABLED: "1" } },
    );
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    return Object.fromEntries(
      Summary.parse(JSON.parse(result.stdout.toString())).tasks.map((t) => [
        t.taskId,
        t.hash,
      ]),
    );
  };
  try {
    await Bun.write(
      path.join(fixture, "package.json"),
      JSON.stringify({
        name: "theme-input-fixture",
        private: true,
        packageManager: `bun@${Bun.version}`,
        workspaces: ["packages/*"],
      }),
    );
    await Bun.write(
      path.join(fixture, "turbo.json"),
      Bun.file(path.join(repository, "turbo.json")),
    );
    await Bun.write(
      path.join(fixture, "packages/storm-theme/turbo.json"),
      Bun.file(path.join(repository, "packages/storm-theme/turbo.json")),
    );
    await Bun.write(
      path.join(fixture, "packages/storm-theme/package.json"),
      JSON.stringify({
        name: "@shepherdjerred/storm-theme",
        scripts: { test: "true", "test:ci": "true", generate: "true" },
      }),
    );
    const docs = path.join(
      fixture,
      "packages/ts-mc-docs/src/content/docs/index.md",
    );
    const runner = path.join(fixture, "scripts/ci/run-ci-test.ts");
    await Bun.write(docs, "---\ntitle: Welcome\n---\n");
    await Bun.write(runner, "export const value = 1;\n");
    const git = Bun.spawnSync(["git", "init", "--quiet"], { cwd: fixture });
    expect(git.exitCode).toBe(0);
    expect(Bun.spawnSync(["git", "add", "."], { cwd: fixture }).exitCode).toBe(
      0,
    );
    const original = hashes();
    await Bun.write(docs, "---\ntitle: Welcome to The Storm\n---\n");
    const changedDocs = hashes();
    for (const name of ["test", "test:ci"]) {
      const id = `@shepherdjerred/storm-theme#${name}`;
      expect(original[id]).toBeDefined();
      expect(changedDocs[id]).not.toBe(original[id]);
    }
    await Bun.write(runner, "export const value = 2;\n");
    const changedRunner = hashes();
    expect(changedRunner["@shepherdjerred/storm-theme#test:ci"]).not.toBe(
      changedDocs["@shepherdjerred/storm-theme#test:ci"],
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
