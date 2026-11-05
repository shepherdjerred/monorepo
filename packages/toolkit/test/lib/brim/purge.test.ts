import { describe, expect, test } from "vitest";
import { readFile, stat, utimes } from "node:fs/promises";
import { readLocalManifest } from "#lib/brim/sync/manifest.ts";
import { createMemoryObjectStore } from "#lib/brim/sync/object-store.ts";
import { pullArchive } from "#lib/brim/sync/pull.ts";
import { pushArchive } from "#lib/brim/sync/push.ts";
import { redactSources } from "#lib/brim/sync/redact-files.ts";
import { syncRoots } from "#lib/brim/sync/scan.ts";
import {
  CLAUDE_SESSION,
  CODEX_SESSION,
  keys,
  machine,
  mirrored,
  pushOptions,
  write,
} from "#test/support/brim-sync.ts";

// A low-entropy stand-in assembled at run time; not a real credential.
const secret = `sk-proj-${"q".repeat(64)}`;
const leakyLine = `${JSON.stringify({ type: "tool", output: `OPENAI_API_KEY=${secret}` })}\n`;
const plainLine = `${JSON.stringify({ type: "user", message: "hello" })}\n`;

async function archivedPlaintext(
  store: ReturnType<typeof createMemoryObjectStore>,
  open: (sealed: Uint8Array) => Promise<Uint8Array>,
): Promise<string> {
  const parts: string[] = [];
  for (const [key, body] of store.objects) {
    if (!key.includes("/f/")) continue;
    parts.push(new TextDecoder().decode(await open(body)));
  }
  return parts.join("");
}

describe("brim sync credential purge", () => {
  test("push redacts secrets before upload and leaves the source alone", async () => {
    const store = createMemoryObjectStore();
    const crypto = await keys();
    const laptop = await machine("laptop");
    const desktop = await machine("desktop");
    const file = await write(laptop.home, CODEX_SESSION, plainLine + leakyLine);

    const report = await pushArchive(pushOptions(laptop, store, crypto));
    expect(report.redactedSecrets).toBe(1);
    expect(await readFile(file, "utf8")).toContain(secret);
    expect(await archivedPlaintext(store, crypto.open)).not.toContain(secret);

    await pullArchive({
      store,
      open: crypto.open,
      paths: desktop.paths,
      machineId: desktop.machineId,
      sinceDays: null,
    });
    const copy = await readFile(
      mirrored(desktop, "laptop", "codex/sessions/2026/11/02/rollout-1.jsonl"),
      "utf8",
    );
    expect(copy).not.toContain(secret);
    expect(copy).toContain("REDACTED-openai-key");
    expect(copy.length).toBe((plainLine + leakyLine).length);
  });

  test("redact rewrites originals in place and replaces their archive generation", async () => {
    const store = createMemoryObjectStore();
    const crypto = await keys();
    const laptop = await machine("laptop");
    const desktop = await machine("desktop");
    const file = await write(
      laptop.home,
      CLAUDE_SESSION,
      leakyLine + plainLine,
    );
    const mtime = new Date("2026-11-01T12:00:00Z");
    await utimes(file, mtime, mtime);
    await pushArchive(pushOptions(laptop, store, crypto));
    const oldSegments = [...store.objects.keys()].filter((key) =>
      key.includes("/f/"),
    );
    const before = await stat(file);

    const report = await redactSources({
      roots: syncRoots({}, laptop.home),
      paths: laptop.paths,
      dryRun: false,
    });
    expect(report.totals).toEqual({ "openai-key": 1 });
    expect(report.regenerated).toBe(1);
    const after = await stat(file);
    expect(after.size).toBe(before.size);
    expect(after.ino).toBe(before.ino);
    expect(after.mtime.toISOString()).toBe(mtime.toISOString());
    const contents = await readFile(file, "utf8");
    expect(contents).not.toContain(secret);
    for (const line of contents.trimEnd().split("\n")) {
      expect(() => JSON.parse(line) as unknown).not.toThrow();
    }
    const retired = await readLocalManifest(laptop.paths.manifest);
    expect(retired?.files[0]?.gen).toBe(1);
    expect(retired?.retired).toEqual([
      { fileKey: retired?.files[0]?.fileKey, gen: 0 },
    ]);

    const push = await pushArchive(pushOptions(laptop, store, crypto));
    expect(push.uploadedSegments).toBe(1);
    for (const key of oldSegments) expect(store.objects.has(key)).toBe(false);
    const manifest = await readLocalManifest(laptop.paths.manifest);
    expect(manifest?.retired).toEqual([]);
    expect(manifest?.files[0]?.size).toBe(before.size);

    await pullArchive({
      store,
      open: crypto.open,
      paths: desktop.paths,
      machineId: desktop.machineId,
      sinceDays: null,
    });
    expect(
      await readFile(
        mirrored(
          desktop,
          "laptop",
          "claude/projects/-Users-me-repo/session-a.jsonl",
        ),
        "utf8",
      ),
    ).toBe(contents);
  });

  test("a dry run reports without touching files or the manifest", async () => {
    const store = createMemoryObjectStore();
    const crypto = await keys();
    const laptop = await machine("laptop");
    const file = await write(laptop.home, CODEX_SESSION, leakyLine);
    await pushArchive(pushOptions(laptop, store, crypto));
    const manifest = await readFile(laptop.paths.manifest, "utf8");

    const report = await redactSources({
      roots: syncRoots({}, laptop.home),
      paths: laptop.paths,
      dryRun: true,
    });
    expect(report.files.map((entry) => entry.relPath)).toEqual([
      "sessions/2026/11/02/rollout-1.jsonl",
    ]);
    expect(report.regenerated).toBe(0);
    expect(await readFile(file, "utf8")).toBe(leakyLine);
    expect(await readFile(laptop.paths.manifest, "utf8")).toBe(manifest);
  });

  test("a clean history reports nothing to redact", async () => {
    const laptop = await machine("laptop");
    await write(laptop.home, CLAUDE_SESSION, plainLine);
    const report = await redactSources({
      roots: syncRoots({}, laptop.home),
      paths: laptop.paths,
      dryRun: false,
    });
    expect(report.files).toEqual([]);
    expect(report.totals).toEqual({});
    expect(report.scannedFiles).toBe(1);
  });
});
