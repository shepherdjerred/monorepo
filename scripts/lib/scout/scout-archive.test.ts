import { expect, test } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertScoutArchiveSource } from "./scout-archive.ts";

test("publication preserves required entrypoints and forbids beta-only UI in production", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "scout-source-policy-"));
  try {
    for (const name of [
      "index.html",
      "app/index.html",
      "docs/index.html",
      "404.html",
    ]) {
      const file = path.join(root, name);
      await mkdir(path.dirname(file), { recursive: true });
      await Bun.write(file, "reviewed entrypoint");
    }
    await assertScoutArchiveSource(root, "prod");
    await expect(assertScoutArchiveSource(root, "beta")).rejects.toThrow(
      "customs/index.html",
    );
    await mkdir(path.join(root, "customs"));
    await Bun.write(
      path.join(root, "customs/index.html"),
      "beta interface ".repeat(20),
    );
    await assertScoutArchiveSource(root, "beta");
    await expect(assertScoutArchiveSource(root, "prod")).rejects.toThrow(
      "forbidden Customs UI",
    );
    await Bun.file(path.join(root, "app/index.html")).delete();
    await expect(assertScoutArchiveSource(root, "beta")).rejects.toThrow(
      "app/index.html",
    );
  } finally {
    await rm(root, { recursive: true });
  }
});
