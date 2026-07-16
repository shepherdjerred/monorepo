import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ensureSessionDir,
  sessionDir,
} from "@shepherdjerred/discord-stream-lifecycle/persistence/session-paths";

async function isDirectory(p: string): Promise<boolean> {
  try {
    const stats = await stat(p);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

describe("sessionDir", () => {
  it("joins rootDir and guildId", () => {
    expect(sessionDir("/saves", "123456789012345678")).toBe(
      path.join("/saves", "123456789012345678"),
    );
  });

  it("rejects guildIds that aren't digits-only", () => {
    expect(() => sessionDir("/saves", "../escape")).toThrow();
    expect(() => sessionDir("/saves", "abc")).toThrow();
    expect(() => sessionDir("/saves", "")).toThrow();
    expect(() => sessionDir("/saves", "12/45")).toThrow();
  });
});

describe("ensureSessionDir", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "dsl-paths-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("creates the directory", async () => {
    const dir = await ensureSessionDir(root, "100000000000000001");
    expect(await isDirectory(dir)).toBe(true);
    expect(dir).toBe(path.join(root, "100000000000000001"));
  });

  it("is idempotent", async () => {
    await ensureSessionDir(root, "100000000000000001");
    await ensureSessionDir(root, "100000000000000001");
    expect(await isDirectory(path.join(root, "100000000000000001"))).toBe(true);
  });
});
