import { describe, expect, test } from "vitest";
import {
  appendFile,
  mkdir,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { generateX25519Identity, identityToRecipient } from "age-encryption";
import { z } from "zod";
import { createOpener, createSealer } from "#lib/brim/sync/crypto.ts";
import { acquireSyncLock } from "#lib/brim/sync/lock.ts";
import {
  manifestKey,
  normalizeMachineId,
  readLocalManifest,
} from "#lib/brim/sync/manifest.ts";
import {
  MirrorIndexSchema,
  readMirrorIndex,
} from "#lib/brim/sync/mirror-index.ts";
import { createMemoryObjectStore } from "#lib/brim/sync/object-store.ts";
import {
  defaultBrimSyncPaths,
  fromArchivePath,
  type BrimSyncPaths,
} from "#lib/brim/sync/paths.ts";
import { pullArchive } from "#lib/brim/sync/pull.ts";
import { pushArchive, type PushOptions } from "#lib/brim/sync/push.ts";
import { scanSourceFiles, syncRoots } from "#lib/brim/sync/scan.ts";
import { brokeredS3Credentials } from "#lib/brim/sync/settings.ts";
import { useTempDirectories } from "#test/support/temp-directories.ts";

const tempHome = useTempDirectories("brim-sync-");

type Machine = {
  readonly home: string;
  readonly paths: BrimSyncPaths;
  readonly machineId: string;
};

async function machine(machineId: string): Promise<Machine> {
  const home = await tempHome();
  return { home, paths: defaultBrimSyncPaths(home), machineId };
}

async function write(
  home: string,
  relative: string,
  contents: string,
): Promise<string> {
  const file = path.join(home, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, contents);
  return file;
}

const CLAUDE_SESSION = ".claude/projects/-Users-me-repo/session-a.jsonl";
const CODEX_SESSION = ".codex/sessions/2026/11/02/rollout-1.jsonl";

async function keys() {
  const identity = await generateX25519Identity();
  const recipient = await identityToRecipient(identity);
  return {
    seal: createSealer(recipient),
    open: createOpener(identity),
  };
}

function pushOptions(
  source: Machine,
  store: ReturnType<typeof createMemoryObjectStore>,
  crypto: Awaited<ReturnType<typeof keys>>,
  overrides: Partial<PushOptions> = {},
): PushOptions {
  return {
    store,
    seal: crypto.seal,
    open: crypto.open,
    paths: source.paths,
    machineId: source.machineId,
    displayName: `${source.machineId}.local`,
    platform: "darwin",
    roots: syncRoots({}, source.home),
    ...overrides,
  };
}

function mirrored(target: Machine, from: string, relative: string): string {
  return path.join(target.paths.mirrorDir, from, relative);
}

describe("brim sync push and pull", () => {
  test("round-trips transcripts byte for byte behind opaque, encrypted keys", async () => {
    const store = createMemoryObjectStore();
    const crypto = await keys();
    const laptop = await machine("laptop");
    const desktop = await machine("desktop");
    await write(laptop.home, CLAUDE_SESSION, '{"a":1}\n{"b":2}\n');
    await write(laptop.home, CODEX_SESSION, '{"c":3}\n');
    await write(laptop.home, ".codex/history.jsonl", '{"h":1}\n');

    const report = await pushArchive(pushOptions(laptop, store, crypto));
    expect(report.errors).toEqual([]);
    expect(report.files).toBe(3);
    for (const [key, body] of store.objects) {
      expect(key).not.toMatch(/projects|sessions|history|rollout|Users/);
      expect(new TextDecoder().decode(body)).not.toContain("projects");
    }

    const pulled = await pullArchive({
      store,
      open: crypto.open,
      paths: desktop.paths,
      machineId: desktop.machineId,
      sinceDays: 30,
    });
    expect(pulled.errors).toEqual([]);
    expect(
      await readFile(
        mirrored(
          desktop,
          "laptop",
          "claude/projects/-Users-me-repo/session-a.jsonl",
        ),
        "utf8",
      ),
    ).toBe('{"a":1}\n{"b":2}\n');
    expect(
      await readFile(
        mirrored(
          desktop,
          "laptop",
          "codex/sessions/2026/11/02/rollout-1.jsonl",
        ),
        "utf8",
      ),
    ).toBe('{"c":3}\n');
    const index = await readMirrorIndex(desktop.paths.mirrorIndex);
    expect(index?.machines.map((entry) => entry.machineId)).toEqual(["laptop"]);
    expect(index?.machines[0]?.claudeProjectsDirs).toEqual([
      mirrored(desktop, "laptop", "claude/projects"),
    ]);
    expect(index?.machines[0]?.codexSessionsDirs).toEqual([
      mirrored(desktop, "laptop", "codex/sessions"),
    ]);
    expect(index?.machines[0]?.codexHistoryFiles).toEqual([
      mirrored(desktop, "laptop", "codex/history.jsonl"),
    ]);
  });

  test("uploads only appended complete lines and appends them to the mirror", async () => {
    const store = createMemoryObjectStore();
    const crypto = await keys();
    const laptop = await machine("laptop");
    const desktop = await machine("desktop");
    const file = await write(laptop.home, CLAUDE_SESSION, '{"a":1}\n');
    await pushArchive(pushOptions(laptop, store, crypto));
    const pull = () =>
      pullArchive({
        store,
        open: crypto.open,
        paths: desktop.paths,
        machineId: desktop.machineId,
        sinceDays: null,
      });
    await pull();

    await appendFile(file, '{"b":2}\n{"partial":');
    const second = await pushArchive(pushOptions(laptop, store, crypto));
    expect(second.uploadedSegments).toBe(1);
    expect(second.uploadedBytes).toBe('{"b":2}\n'.length);
    const pulled = await pull();
    expect(pulled.machines[0]?.rebuiltFiles).toBe(0);
    expect(pulled.machines[0]?.downloadedBytes).toBe('{"b":2}\n'.length);
    const target = mirrored(
      desktop,
      "laptop",
      "claude/projects/-Users-me-repo/session-a.jsonl",
    );
    expect(await readFile(target, "utf8")).toBe('{"a":1}\n{"b":2}\n');

    await appendFile(file, '"done"}\n');
    await pushArchive(pushOptions(laptop, store, crypto));
    await pull();
    expect(await readFile(target, "utf8")).toBe(
      '{"a":1}\n{"b":2}\n{"partial":"done"}\n',
    );
    const unchanged = await pushArchive(pushOptions(laptop, store, crypto));
    expect(unchanged.uploadedSegments).toBe(0);
    expect(unchanged.commits).toBe(0);
  });

  test("starts a new generation when a file is rewritten and purges the old one", async () => {
    const store = createMemoryObjectStore();
    const crypto = await keys();
    const laptop = await machine("laptop");
    const desktop = await machine("desktop");
    const file = await write(
      laptop.home,
      CODEX_SESSION,
      '{"old":1}\n{"old":2}\n',
    );
    await pushArchive(pushOptions(laptop, store, crypto));
    const firstKeys = [...store.objects.keys()];

    await writeFile(file, '{"new":1}\n');
    const report = await pushArchive(pushOptions(laptop, store, crypto));
    expect(report.rewrittenFiles).toBe(1);
    const manifest = await readLocalManifest(laptop.paths.manifest);
    expect(manifest?.files[0]?.gen).toBe(1);
    expect(manifest?.retired).toEqual([]);
    const oldSegments = firstKeys.filter((key) => key.includes("/f/"));
    for (const key of oldSegments) {
      expect(store.objects.has(key)).toBe(false);
    }

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
          "codex/sessions/2026/11/02/rollout-1.jsonl",
        ),
        "utf8",
      ),
    ).toBe('{"new":1}\n');
  });

  test("keeps a locally deleted transcript in the archive", async () => {
    const store = createMemoryObjectStore();
    const crypto = await keys();
    const laptop = await machine("laptop");
    const file = await write(laptop.home, CLAUDE_SESSION, '{"a":1}\n');
    await pushArchive(pushOptions(laptop, store, crypto));
    const segmentKeys = [...store.objects.keys()].filter((key) =>
      key.includes("/f/"),
    );
    await rm(file);

    const report = await pushArchive(pushOptions(laptop, store, crypto));
    expect(report.newlyDeletedFiles).toBe(1);
    const manifest = await readLocalManifest(laptop.paths.manifest);
    expect(manifest?.files[0]?.deletedAt).not.toBeNull();
    for (const key of segmentKeys) {
      expect(store.objects.has(key)).toBe(true);
    }
  });
});

describe("brim sync windows and recovery", () => {
  test("mirrors only the pull window and prunes files that age out", async () => {
    const store = createMemoryObjectStore();
    const crypto = await keys();
    const laptop = await machine("laptop");
    const desktop = await machine("desktop");
    const now = new Date("2026-11-02T12:00:00Z");
    const recent = await write(laptop.home, CLAUDE_SESSION, '{"a":1}\n');
    const old = await write(laptop.home, CODEX_SESSION, '{"b":1}\n');
    await utimes(recent, now, new Date("2026-11-01T00:00:00Z"));
    await utimes(old, now, new Date("2026-08-01T00:00:00Z"));
    await pushArchive(pushOptions(laptop, store, crypto));

    const pull = (sinceDays: number | null) =>
      pullArchive({
        store,
        open: crypto.open,
        paths: desktop.paths,
        machineId: desktop.machineId,
        sinceDays,
        now: () => now,
      });
    await pull(null);
    const oldTarget = mirrored(
      desktop,
      "laptop",
      "codex/sessions/2026/11/02/rollout-1.jsonl",
    );
    const oldInfo = await stat(oldTarget);
    expect(oldInfo.mtime.toISOString()).toBe("2026-08-01T00:00:00.000Z");

    const windowed = await pull(30);
    expect(windowed.machines[0]?.mirroredFiles).toBe(1);
    expect(windowed.machines[0]?.prunedFiles).toBe(1);
    await expect(stat(oldTarget)).rejects.toThrow();
  });

  test("adopts the remote manifest when local state is lost", async () => {
    const store = createMemoryObjectStore();
    const crypto = await keys();
    const laptop = await machine("laptop");
    await write(laptop.home, CLAUDE_SESSION, '{"a":1}\n');
    await pushArchive(pushOptions(laptop, store, crypto));
    await rm(laptop.paths.manifest);

    await expect(
      pushArchive(pushOptions(laptop, store, crypto, { open: null })),
    ).rejects.toThrow(/BRIM_SYNC_AGE_IDENTITY/);
    const adopted = await pushArchive(pushOptions(laptop, store, crypto));
    expect(adopted.uploadedSegments).toBe(0);
    expect(adopted.files).toBe(1);
  });

  test("splits large files at newline boundaries and rejects oversized lines", async () => {
    const store = createMemoryObjectStore();
    const crypto = await keys();
    const laptop = await machine("laptop");
    const desktop = await machine("desktop");
    const lines = Array.from(
      { length: 20 },
      (_, index) => `{"n":${String(index)}}\n`,
    );
    await write(laptop.home, CLAUDE_SESSION, lines.join(""));
    await write(laptop.home, CODEX_SESSION, `{"long":"${"x".repeat(200)}"}\n`);

    const report = await pushArchive(
      pushOptions(laptop, store, crypto, { segmentLimitBytes: 64 }),
    );
    expect(report.errors.map((error) => error.relPath)).toEqual([
      "sessions/2026/11/02/rollout-1.jsonl",
    ]);
    expect(report.uploadedSegments).toBeGreaterThanOrEqual(3);
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
    ).toBe(lines.join(""));
  });

  test("never pulls its own archive and rejects a tampered segment", async () => {
    const store = createMemoryObjectStore();
    const crypto = await keys();
    const laptop = await machine("laptop");
    const desktop = await machine("desktop");
    await write(laptop.home, CLAUDE_SESSION, '{"a":1}\n');
    await pushArchive(pushOptions(laptop, store, crypto));

    const own = await pullArchive({
      store,
      open: crypto.open,
      paths: laptop.paths,
      machineId: laptop.machineId,
      sinceDays: null,
    });
    expect(own.machines).toEqual([]);

    const segment = [...store.objects.keys()].find((key) =>
      key.includes("/f/"),
    );
    expect(segment).toBeDefined();
    if (segment === undefined) return;
    store.objects.set(
      segment,
      await crypto.seal(new TextEncoder().encode("{}\n")),
    );
    const tampered = await pullArchive({
      store,
      open: crypto.open,
      paths: desktop.paths,
      machineId: desktop.machineId,
      sinceDays: null,
    });
    expect(tampered.errors[0]?.message).toMatch(/checksum/);
  });

  test("the manifest key is per machine", () => {
    expect(manifestKey("laptop")).toBe("v1/machines/laptop/manifest.age");
  });
});

describe("brim sync scanning and paths", () => {
  test("honours CLAUDE_CONFIG_DIR and CODEX_HOME, numbering several dirs", async () => {
    const home = await tempHome();
    await write(home, "a/projects/p/s.jsonl", "{}\n");
    await write(home, "b/projects/p/s.jsonl", "{}\n");
    await write(home, "cx/sessions/s.jsonl", "{}\n");
    await write(home, "cx/archived_sessions/old.jsonl", "{}\n");
    await write(home, "cx/sessions/notes.txt", "ignored");
    const roots = syncRoots(
      { CLAUDE_CONFIG_DIR: "~/a, ~/b", CODEX_HOME: "~/cx" },
      home,
    );
    const files = await scanSourceFiles(roots);
    expect(files.map((file) => `${file.tool}:${file.relPath}`)).toEqual([
      "claude:0/projects/p/s.jsonl",
      "claude:1/projects/p/s.jsonl",
      "codex:sessions/s.jsonl",
      "codex:archived_sessions/old.jsonl",
    ]);
  });

  test("refuses archive paths that escape the mirror", () => {
    expect(() => fromArchivePath("/m", "../etc/passwd")).toThrow();
    expect(() => fromArchivePath("/m", "/abs")).toThrow();
    expect(() => fromArchivePath("/m", "a//b")).toThrow();
    expect(() => fromArchivePath("/m", String.raw`C:\x`)).toThrow();
    expect(fromArchivePath("/m", "projects/a.jsonl")).toBe(
      path.join("/m", "projects", "a.jsonl"),
    );
  });

  test("derives a machine id from the hostname", () => {
    expect(normalizeMachineId("Jerreds-MacBook-Pro.local")).toBe(
      "jerreds-macbook-pro",
    );
    expect(normalizeMachineId("DESKTOP_42")).toBe("desktop-42");
    expect(() => normalizeMachineId("___")).toThrow(/machine id/);
  });

  test("a second process cannot take a live lock", async () => {
    const home = await tempHome();
    const file = path.join(home, "sync.lock");
    const first = await acquireSyncLock(file);
    expect(first).not.toBeNull();
    expect(await acquireSyncLock(file)).toBeNull();
    await first?.release();
    await writeFile(file, "999999999");
    const stale = await acquireSyncLock(file);
    expect(stale).not.toBeNull();
    await stale?.release();
  });
});

describe("brim sync mirror index contract", () => {
  const schemaDir = path.join(import.meta.dirname, "../../schemas");

  test("the checked-in JSON Schema matches the zod schema", async () => {
    const checkedIn: unknown = JSON.parse(
      await readFile(
        path.join(schemaDir, "brim-sync-mirror-index.schema.json"),
        "utf8",
      ),
    );
    expect(z.toJSONSchema(MirrorIndexSchema)).toEqual(checkedIn);
  });

  test("the shared fixture decodes", async () => {
    const fixture: unknown = JSON.parse(
      await readFile(
        path.join(schemaDir, "fixtures/brim-sync-mirror-index.json"),
        "utf8",
      ),
    );
    const parsed = MirrorIndexSchema.parse(fixture);
    expect(parsed.machines.map((entry) => entry.machineId)).toEqual([
      "jerred-pc",
      "studio",
    ]);
  });
});

describe("brim sync S3 credentials", () => {
  const settings = {
    machineId: "studio",
    displayName: "studio",
    platform: "darwin",
    bucket: "brim-sessions",
    profile: "brim-sync",
    recipient: "unused",
    pullSinceDays: 30,
  };

  test("profile mode leaves the keys to the AWS profile", async () => {
    await expect(
      brokeredS3Credentials({ ...settings, s3Credentials: "profile" }),
    ).resolves.toBeUndefined();
  });

  test("broker mode resolves the registered keys in-process", async () => {
    const previous = {
      id: Bun.env["BRIM_SYNC_S3_ACCESS_KEY_ID"],
      secret: Bun.env["BRIM_SYNC_S3_SECRET_ACCESS_KEY"],
    };
    Bun.env["BRIM_SYNC_S3_ACCESS_KEY_ID"] = "ambient-id";
    Bun.env["BRIM_SYNC_S3_SECRET_ACCESS_KEY"] = "ambient-secret";
    try {
      await expect(
        brokeredS3Credentials({ ...settings, s3Credentials: "broker" }),
      ).resolves.toEqual({
        accessKeyId: "ambient-id",
        secretAccessKey: "ambient-secret",
      });
    } finally {
      Bun.env["BRIM_SYNC_S3_ACCESS_KEY_ID"] = previous.id;
      Bun.env["BRIM_SYNC_S3_SECRET_ACCESS_KEY"] = previous.secret;
    }
  });
});
