import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, expect, it } from "vitest";
import { withPublicationLock } from "#build/storage/publication-lock.ts";

const root = await mkdtemp(path.join(tmpdir(), "mc-publication-lock-"));
afterAll(async () => rm(root, { recursive: true }));

it.each(["finish", "kill"])(
  "excludes another process and releases its lock after %s",
  async (ending) => {
    const dir = await mkdtemp(path.join(root, `${ending}-`));
    const alias = `${dir}-alias`;
    await symlink(dir, alias, "dir");
    const module = path.resolve(
      import.meta.dirname,
      "../../src/build/storage/publication-lock.ts",
    );
    const script = [
      `import { withPublicationLock } from ${JSON.stringify(module)};`,
      `await withPublicationLock(${JSON.stringify(dir)}, async () => {`,
      '  console.log("locked");',
      "  await Bun.stdin.text();",
      "});",
    ].join("\n");
    const child = Bun.spawn([process.execPath, "--eval", script], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    try {
      const reader = child.stdout.getReader();
      const ready = await reader.read();
      reader.releaseLock();
      expect(new TextDecoder().decode(ready.value)).toContain("locked");
      let called = false;
      const publish = () => {
        called = true;
        return Promise.resolve();
      };
      await expect(withPublicationLock(dir, publish)).rejects.toThrow(
        /already running/u,
      );
      await expect(withPublicationLock(alias, publish)).rejects.toThrow(
        /already running/u,
      );
      expect(called).toBe(false);
      if (ending === "kill") child.kill("SIGKILL");
      else await child.stdin.end();
      const [code, stderr] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
      ]);
      expect(stderr).toBe("");
      if (ending === "finish") expect(code).toBe(0);
      await withPublicationLock(alias, publish);
      expect(called).toBe(true);
    } finally {
      child.kill("SIGKILL");
      await child.exited;
    }
  },
  10_000,
);
