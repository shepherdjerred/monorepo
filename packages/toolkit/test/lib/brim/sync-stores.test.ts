import { describe, expect, test } from "vitest";
import { Database } from "bun:sqlite";
import { appendFile, readFile, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  fileKeyFor,
  generationPrefix,
  readLocalManifest,
} from "#lib/brim/sync/manifest.ts";
import { readMirrorIndex } from "#lib/brim/sync/mirror-index.ts";
import { createMemoryObjectStore } from "#lib/brim/sync/object-store.ts";
import { pullArchive } from "#lib/brim/sync/pull.ts";
import { pushArchive } from "#lib/brim/sync/push.ts";
import { syncRoots } from "#lib/brim/sync/roots.ts";
import { scanSourceFiles } from "#lib/brim/sync/scan.ts";
import { sqliteSnapshot } from "#lib/brim/sync/snapshot.ts";
import { defaultHistoryPaths } from "#lib/history/paths.ts";
import { createHistorySources } from "#lib/history/sources.ts";
import type { HistorySource } from "#lib/history/types.ts";
import {
  keys,
  machine,
  mirrored,
  pushOptions,
  tempHome,
  write,
  type Machine,
} from "#test/support/brim-sync.ts";
import { writeAntigravityFixture } from "#test/history/history-fixtures/antigravity.ts";
import { writeGrokFixture } from "#test/history/history-fixtures/grok.ts";
import { writeKimiFixture } from "#test/history/history-fixtures/kimi.ts";
import {
  MUSE_SESSION_ID,
  writeMuseFixture,
} from "#test/history/history-fixtures/muse.ts";

// Built from parts so secret scanners don't flag a synthetic marker.
const PEM_LABEL = ["PRIVATE", "KEY"].join(" ");

// Low-entropy stand-ins assembled at run time; none is a real credential.
const linear = `lin_api_${"c".repeat(40)}`;
const anthropic = `sk-ant-api03-${"a".repeat(90)}`;

const GROK = ".grok/sessions/%2Ftest%2Fproject/grok-session-1";
const ANTIGRAVITY = ".gemini/antigravity-cli";
const DAY_MS = 86_400_000;

function source(name: string): HistorySource {
  const found = createHistorySources().find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`no ${name} source`);
  return found;
}

async function writeAgentStores(home: string): Promise<void> {
  await writeGrokFixture(path.join(home, ".grok"));
  // Push archives complete lines only; the fixture omits the final newline.
  await appendFile(path.join(home, GROK, "updates.jsonl"), "\n");
  await write(
    home,
    `${GROK}/summary.json`,
    JSON.stringify({ info: { id: "grok-session-1", cwd: "/test/project" } }),
  );
  await writeKimiFixture(path.join(home, ".kimi-code/sessions"));
  await writeMuseFixture(path.join(home, ".local/share/muse"));
  await writeAntigravityFixture(path.join(home, ANTIGRAVITY));
}

async function pull(
  target: Machine,
  crypto: Awaited<ReturnType<typeof keys>>,
  store: ReturnType<typeof createMemoryObjectStore>,
  sinceDays: number | null = null,
) {
  return pullArchive({
    store,
    open: crypto.open,
    paths: target.paths,
    machineId: target.machineId,
    sinceDays,
  });
}

function walDatabase(file: string): Database {
  const database = new Database(file);
  database.run("PRAGMA journal_mode = WAL");
  database.run("PRAGMA wal_autocheckpoint = 0");
  return database;
}

describe("brim sync agent stores: scanning", () => {
  test("selects only the files each history reader opens", async () => {
    const home = await tempHome();
    const files = [
      `${GROK}/updates.jsonl`,
      `${GROK}/summary.json`,
      `${GROK}/updates.jsonl.lock`,
      `${GROK}/system_prompt.txt`,
      ".grok/sessions/%2Fother/no-log/summary.json",
      ".grok/auth.json",
      ".kimi-code/sessions/wd_a/s1/state.json",
      ".kimi-code/sessions/wd_a/s1/agents/main/wire.jsonl",
      ".kimi-code/sessions/wd_a/s1/agents/main/tasks/wire.jsonl",
      ".kimi-code/sessions/wd_a/s1/agents/main/output.log",
      ".kimi-code/sessions/wd_a/s2/state.json",
      ".kimi-code/session_index.jsonl",
      ".local/share/muse/session-index.db",
      ".local/share/muse/session-index.db-wal",
      ".local/share/muse/tui-history.jsonl",
      ".local/share/muse/sessions/2026/11/11/m1/session.jsonl",
      ".local/share/muse/sessions/2026/11/11/m1/subagent/u1/session.jsonl",
      ".local/share/muse/sessions/2026/11/11/m1/.session.lock",
      `${ANTIGRAVITY}/conversations/c1.db`,
      `${ANTIGRAVITY}/conversations/c1.db-wal`,
      `${ANTIGRAVITY}/brain/c1/.system_generated/logs/transcript_full.jsonl`,
      `${ANTIGRAVITY}/brain/c1/task.md`,
      `${ANTIGRAVITY}/brain/c2/.system_generated/logs/transcript_full.jsonl`,
      `${ANTIGRAVITY}/conversation_summaries.db`,
      `${ANTIGRAVITY}/history.jsonl`,
    ];
    for (const file of files) await write(home, file, "{}\n");
    const scanned = await scanSourceFiles(syncRoots({}, home));
    expect(
      scanned.map((file) => `${file.tool}:${file.format.kind}:${file.relPath}`),
    ).toEqual([
      "grok:json:sessions/%2Ftest%2Fproject/grok-session-1/summary.json",
      "grok:jsonl:sessions/%2Ftest%2Fproject/grok-session-1/updates.jsonl",
      "kimi:jsonl:sessions/wd_a/s1/agents/main/wire.jsonl",
      "kimi:json:sessions/wd_a/s1/state.json",
      "muse:sqlite:session-index.db",
      "muse:jsonl:sessions/2026/11/11/m1/session.jsonl",
      "muse:jsonl:sessions/2026/11/11/m1/subagent/u1/session.jsonl",
      "antigravity:sqlite:gemini-antigravity-cli/conversations/c1.db",
      "antigravity:jsonl:gemini-antigravity-cli/brain/c1/.system_generated/logs/transcript_full.jsonl",
      "antigravity:sqlite:gemini-antigravity-cli/conversation_summaries.db",
    ]);
  });

  test("a group shares its newest mtime so a pull window keeps it whole", async () => {
    const home = await tempHome();
    const state = await write(
      home,
      ".kimi-code/sessions/wd/s/state.json",
      "{}",
    );
    const wire = await write(
      home,
      ".kimi-code/sessions/wd/s/agents/main/wire.jsonl",
      "{}\n",
    );
    const old = new Date(Date.now() - 90 * DAY_MS);
    await utimes(state, old, old);
    const recent = new Date();
    await utimes(wire, recent, recent);
    const scanned = await scanSourceFiles(syncRoots({}, home));
    expect(new Set(scanned.map((file) => file.mtimeMs))).toEqual(
      new Set([recent.getTime()]),
    );
  });
});

describe("brim sync agent stores: SQLite snapshots", () => {
  test("captures committed WAL pages without copying the live file", async () => {
    const home = await tempHome();
    const file = path.join(home, "live.db");
    const writer = walDatabase(file);
    try {
      writer.run(
        "CREATE TABLE sessions (id TEXT, title TEXT, body TEXT, n INTEGER)",
      );
      writer.run("CREATE VIRTUAL TABLE search USING fts5(body)");
      writer.run(
        "INSERT INTO sessions VALUES ('s1', 'only-in-the-wal', 'private body', 9007199254740993)",
      );
      writer.run("INSERT INTO search VALUES ('private body')");
      const mainFile = await readFile(file, "latin1");
      expect(mainFile).not.toContain("only-in-the-wal");

      const snapshot = await sqliteSnapshot(file, {
        tables: [{ table: "sessions", columns: ["id", "title", "n"] }],
      });
      expect(snapshot.bytes[18]).toBe(1);
      expect(snapshot.bytes[19]).toBe(1);
      expect(Buffer.from(snapshot.bytes).toString("latin1")).not.toContain(
        "private body",
      );
      const copy = Database.deserialize(snapshot.bytes, {
        readonly: true,
        safeIntegers: true,
      });
      try {
        expect(copy.query("SELECT name FROM sqlite_master").all()).toEqual([
          { name: "sessions" },
        ]);
        expect(copy.query("SELECT * FROM sessions").all()).toEqual([
          { id: "s1", title: "only-in-the-wal", n: 9_007_199_254_740_993n },
        ]);
      } finally {
        copy.close();
      }
    } finally {
      writer.close();
    }
  });

  test("redacts each text and blob cell and leaves no secret in free pages", async () => {
    const home = await tempHome();
    const file = path.join(home, "secrets.db");
    const database = new Database(file);
    database.run("CREATE TABLE t (title TEXT, data BLOB, other TEXT)");
    database
      .prepare("INSERT INTO t VALUES (?, ?, ?)")
      .run(
        `deploy with ${linear}`,
        new TextEncoder().encode(`\u{12}@key ${anthropic}\u{18}\u{1}`),
        `never copied ${linear}`,
      );
    database
      .prepare("INSERT INTO t VALUES (?, NULL, NULL)")
      .run(`-----BEGIN ${PEM_LABEL}----- in one row`);
    database
      .prepare("INSERT INTO t VALUES (?, NULL, NULL)")
      .run(`and -----END ${PEM_LABEL}----- in another`);
    database.close();

    const snapshot = await sqliteSnapshot(file, {
      tables: [{ table: "t", columns: ["title", "data"] }],
    });
    expect(snapshot.matches.map((match) => match.kind).toSorted()).toEqual([
      "anthropic-key",
      "linear-key",
    ]);
    const raw = Buffer.from(snapshot.bytes).toString("latin1");
    expect(raw).not.toContain(linear);
    expect(raw).not.toContain(anthropic);
    expect(raw).not.toContain("never copied");
    const copy = Database.deserialize(snapshot.bytes, { readonly: true });
    try {
      const rows = z
        .array(
          z.object({
            title: z.string(),
            data: z.instanceof(Uint8Array).nullable(),
          }),
        )
        .parse(copy.query("SELECT title, data FROM t").all());
      expect(rows[0]?.title).toMatch(/^deploy with REDACTED-linear-key/);
      expect(
        new TextDecoder().decode(rows[0]?.data ?? new Uint8Array()),
      ).toContain("REDACTED-anthropic-key");
      // PEM halves in separate cells are not paired: each cell is redacted
      // on its own.
      expect(rows[1]?.title).toBe(`-----BEGIN ${PEM_LABEL}----- in one row`);
      expect(rows[2]?.title).toBe(`and -----END ${PEM_LABEL}----- in another`);
    } finally {
      copy.close();
    }
  });

  test("stores Muse session paths relative to the Muse root", async () => {
    const laptop = await machine("laptop");
    await writeMuseFixture(path.join(laptop.home, ".local/share/muse"));
    const scanned = await scanSourceFiles(syncRoots({}, laptop.home));
    const index = scanned.find((file) => file.format.kind === "sqlite");
    if (index?.format.kind !== "sqlite") throw new Error("no Muse index");
    const snapshot = await sqliteSnapshot(
      index.absolutePath,
      index.format.projection,
    );
    const copy = Database.deserialize(snapshot.bytes, { readonly: true });
    try {
      expect(
        copy.query("SELECT session_dir, session_log_path FROM sessions").get(),
      ).toEqual({
        session_dir: `sessions/2026/11/11/${MUSE_SESSION_ID}`,
        session_log_path: `sessions/2026/11/11/${MUSE_SESSION_ID}/session.jsonl`,
      });
    } finally {
      copy.close();
    }
  });
});

describe("brim sync agent stores: push, pull and history", () => {
  test("mirrors every store and indexes it under the remote machine", async () => {
    const store = createMemoryObjectStore();
    const crypto = await keys();
    const laptop = await machine("laptop");
    const desktop = await machine("desktop");
    await writeAgentStores(laptop.home);

    const pushed = await pushArchive(pushOptions(laptop, store, crypto));
    expect(pushed.errors).toEqual([]);
    for (const [key] of store.objects) {
      expect(key).not.toMatch(/grok|kimi|muse|antigravity|session/);
    }
    const pulled = await pull(desktop, crypto, store);
    expect(pulled.errors).toEqual([]);
    const index = await readMirrorIndex(desktop.paths.mirrorIndex);
    const remote = index?.machines[0];
    expect(remote?.grokHomes).toEqual([mirrored(desktop, "laptop", "grok")]);
    expect(remote?.kimiSessionsDirs).toEqual([
      mirrored(desktop, "laptop", "kimi/sessions"),
    ]);
    expect(remote?.museRoots).toEqual([mirrored(desktop, "laptop", "muse")]);
    expect(remote?.antigravityRoots).toEqual([
      mirrored(desktop, "laptop", "antigravity/gemini-antigravity-cli"),
    ]);

    const paths = defaultHistoryPaths(desktop.home);
    for (const [name, local] of [
      ["grok-mirror", "grok"],
      ["kimi-mirror", "kimi"],
      ["muse-mirror", "muse"],
      ["antigravity-mirror", "antigravity"],
    ] as const) {
      const result = await source(name).scan(paths);
      expect(result.error).toBeNull();
      expect(result.documents.length).toBeGreaterThan(0);
      const expected = await source(local).scan(
        defaultHistoryPaths(laptop.home),
      );
      expect(result.documents.length).toBe(expected.documents.length);
      for (const document of result.documents) {
        expect(document.source).toBe(name);
        expect(document.machine).toBe("laptop");
        expect(document.sourceId.startsWith("laptop/")).toBe(true);
        expect(document.agent).toContain("laptop.local");
      }
      expect(
        result.documents.map((document) => document.usageEvents.length),
      ).toEqual(
        expected.documents.map((document) => document.usageEvents.length),
      );
    }
    const muse = await source("muse-mirror").scan(paths);
    expect(muse.documents.map((document) => document.title)).toContain(
      "Muse fixture title",
    );
  });

  test("re-archives a JSON or SQLite file only when its content changes", async () => {
    const store = createMemoryObjectStore();
    const crypto = await keys();
    const laptop = await machine("laptop");
    const desktop = await machine("desktop");
    await write(laptop.home, `${GROK}/updates.jsonl`, '{"a":1}\n');
    const summary = await write(
      laptop.home,
      `${GROK}/summary.json`,
      JSON.stringify({ title: "first", token: linear }),
    );
    const first = await pushArchive(pushOptions(laptop, store, crypto));
    expect(first.redactedSecrets).toBe(1);
    const touched = new Date(Date.now() + 1000);
    await utimes(summary, touched, touched);
    const same = await pushArchive(pushOptions(laptop, store, crypto));
    expect(same.uploadedSegments).toBe(0);

    await writeFile(summary, JSON.stringify({ title: "second" }));
    const changed = await pushArchive(pushOptions(laptop, store, crypto));
    expect(changed.uploadedSegments).toBe(1);
    expect(changed.changedFiles).toBe(1);
    await pull(desktop, crypto, store);
    expect(
      await readFile(
        mirrored(
          desktop,
          "laptop",
          "grok/sessions/%2Ftest%2Fproject/grok-session-1/summary.json",
        ),
        "utf8",
      ),
    ).toBe(JSON.stringify({ title: "second" }));

    await writeFile(summary, '{"title": "torn');
    const torn = await pushArchive(pushOptions(laptop, store, crypto));
    expect(torn.errors.map((error) => error.relPath)).toEqual([
      "sessions/%2Ftest%2Fproject/grok-session-1/summary.json",
    ]);
  });

  test("a mirrored Muse index tolerates sessions outside the pull window", async () => {
    const store = createMemoryObjectStore();
    const crypto = await keys();
    const laptop = await machine("laptop");
    const desktop = await machine("desktop");
    const muse = await writeMuseFixture(
      path.join(laptop.home, ".local/share/muse"),
    );
    const old = new Date(Date.now() - 90 * DAY_MS);
    const scanned = await scanSourceFiles(syncRoots({}, laptop.home));
    for (const log of [
      path.join(muse.sessionDir, "session.jsonl"),
      ...scanned
        .filter((file) => file.relPath.includes("/subagent/"))
        .map((file) => file.absolutePath),
    ]) {
      await utimes(log, old, old);
    }
    await pushArchive(pushOptions(laptop, store, crypto));
    await pull(desktop, crypto, store, 30);
    const result = await source("muse-mirror").scan(
      defaultHistoryPaths(desktop.home),
    );
    expect(result.error).toBeNull();
    expect(result.documents).toEqual([]);
  });

  test("an index written before the new stores means none are mirrored", async () => {
    const desktop = await machine("desktop");
    await write(
      desktop.home,
      ".toolkit/brim-sync/mirror/index.json",
      JSON.stringify({
        schemaVersion: 1,
        generatedAt: "2026-11-02T00:00:00.000Z",
        machines: [
          {
            machineId: "laptop",
            displayName: "laptop.local",
            platform: "darwin",
            manifestUpdatedAt: "2026-11-02T00:00:00.000Z",
            pulledAt: "2026-11-02T00:00:00.000Z",
            sinceDays: 30,
            rootDir: path.join(desktop.paths.mirrorDir, "laptop"),
            claudeProjectsDirs: [],
            codexSessionsDirs: [],
            codexArchivedSessionsDirs: [],
            codexHistoryFiles: [],
          },
        ],
      }),
    );
    const index = await readMirrorIndex(desktop.paths.mirrorIndex);
    expect(index?.machines).toHaveLength(1);
    const paths = defaultHistoryPaths(desktop.home);
    for (const name of [
      "grok-mirror",
      "kimi-mirror",
      "muse-mirror",
      "antigravity-mirror",
    ]) {
      const result = await source(name).scan(paths);
      expect(result.error).toBeNull();
      expect(result.available).toBe(false);
    }
  });
});

describe("brim sync agent stores: failed uploads", () => {
  test("a failed replacement upload keeps the archived generation", async () => {
    const store = createMemoryObjectStore();
    const crypto = await keys();
    const laptop = await machine("laptop");
    const desktop = await machine("desktop");
    const relPath = "sessions/%2Ftest%2Fproject/grok-session-1/summary.json";
    const mirrorFile = mirrored(desktop, "laptop", `grok/${relPath}`);
    await write(laptop.home, `${GROK}/updates.jsonl`, '{"a":1}\n');
    const summary = await write(
      laptop.home,
      `${GROK}/summary.json`,
      JSON.stringify({ title: "first" }),
    );
    await pushArchive(pushOptions(laptop, store, crypto));
    await pull(desktop, crypto, store);
    const entryOf = async () => {
      const manifest = await readLocalManifest(laptop.paths.manifest);
      return manifest?.files.find((file) => file.relPath === relPath);
    };
    const before = await entryOf();
    expect(before?.gen).toBe(0);

    await writeFile(summary, JSON.stringify({ title: "second" }));
    const next = generationPrefix("laptop", fileKeyFor("grok", relPath), 1);
    const failing = {
      ...store,
      put: (key: string, body: Uint8Array) =>
        key.startsWith(next)
          ? Promise.reject(new Error("simulated upload failure"))
          : store.put(key, body),
    };
    const failed = await pushArchive(
      pushOptions(laptop, store, crypto, { store: failing }),
    );
    expect(failed.errors).toEqual([
      { relPath, message: "simulated upload failure" },
    ]);
    expect(await entryOf()).toEqual(before);
    const manifest = await readLocalManifest(laptop.paths.manifest);
    expect(manifest?.retired).toEqual([]);
    await pull(desktop, crypto, store);
    expect(await readFile(mirrorFile, "utf8")).toBe(
      JSON.stringify({ title: "first" }),
    );

    const retried = await pushArchive(pushOptions(laptop, store, crypto));
    expect(retried.errors).toEqual([]);
    expect(retried.uploadedSegments).toBe(1);
    const replaced = await entryOf();
    expect(replaced?.gen).toBe(1);
    await pull(desktop, crypto, store);
    expect(await readFile(mirrorFile, "utf8")).toBe(
      JSON.stringify({ title: "second" }),
    );
    const old = generationPrefix("laptop", fileKeyFor("grok", relPath), 0);
    expect(await store.listKeys(old)).toEqual([]);
  });
});
