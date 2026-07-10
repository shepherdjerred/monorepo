import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { resolveModelConfig } from "tasknotes-types/v2";

import { TaskRepository } from "../engine/task-repository.ts";
import { v2Routes } from "../v2/routes.ts";
import { envelopeMiddleware } from "../middleware/envelope.ts";

/**
 * HTTP-level proof of review finding #6: an Obsidian edit landing between
 * the server's cache state and an API mutation must survive. The old
 * server wrote whole files from its stale in-memory Task, clobbering
 * concurrent edits; the new engine re-reads from disk and patches only the
 * keys the mutation touches.
 */

const NOW = new Date("2026-07-03T12:00:00.000Z");
const ID = encodeURIComponent("TaskNotes/shared.md");

let vault: string;
let app: Hono;

const ORIGINAL = `---
title: Shared task
status: open
priority: normal
obsidian-only-key: precious
tags:
  - task
---

Original body.
`;

beforeEach(async () => {
  vault = await mkdtemp(path.join(tmpdir(), "tn-conc-"));
  await mkdir(path.join(vault, "TaskNotes"), { recursive: true });
  await writeFile(path.join(vault, "TaskNotes/shared.md"), ORIGINAL);
  const config = resolveModelConfig();
  const repo = new TaskRepository(vault, "TaskNotes", config, () => NOW);
  await repo.scan();
  app = new Hono();
  app.use("*", envelopeMiddleware);
  app.route(
    "/",
    v2Routes({ repo, config, vaultPath: vault, clock: () => NOW }),
  );
});

async function obsidianEdits(patch: (raw: string) => string): Promise<void> {
  const file = path.join(vault, "TaskNotes/shared.md");
  await writeFile(file, patch(await Bun.file(file).text()));
}

async function rawFile(): Promise<string> {
  return Bun.file(path.join(vault, "TaskNotes/shared.md")).text();
}

describe("concurrent Obsidian edits survive API mutations (HTTP)", () => {
  test("body edited on disk after scan survives a PUT", async () => {
    await obsidianEdits((raw) =>
      raw.replace("Original body.", "Body EDITED in Obsidian."),
    );
    const res = await app.request(`/api/tasks/${ID}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ priority: "high" }),
    });
    expect(res.status).toBe(200);
    const raw = await rawFile();
    expect(raw).toContain("Body EDITED in Obsidian.");
    expect(raw).toContain("priority: high");
    expect(raw).toContain("obsidian-only-key: precious");
  });

  test("frontmatter key added on disk survives toggle-status", async () => {
    await obsidianEdits((raw) =>
      raw.replace(
        "obsidian-only-key: precious",
        "obsidian-only-key: precious\nanother-new-key: added-mid-flight",
      ),
    );
    const res = await app.request(`/api/tasks/${ID}/toggle-status`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const raw = await rawFile();
    expect(raw).toContain("another-new-key: added-mid-flight");
    expect(raw).toContain("status: in-progress");
  });

  test("sequential mutations interleaved with disk edits lose nothing", async () => {
    const first = await app.request(`/api/tasks/${ID}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ due: "2026-07-09" }),
    });
    expect(first.status).toBe(200);
    await obsidianEdits((raw) => `${raw}\nAppended by Obsidian.\n`);
    const second = await app.request(`/api/tasks/${ID}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ priority: "low" }),
    });
    expect(second.status).toBe(200);

    const raw = await rawFile();
    expect(raw).toContain("due: 2026-07-09");
    expect(raw).toContain("priority: low");
    expect(raw).toContain("Appended by Obsidian.");
    expect(raw).toContain("obsidian-only-key: precious");
  });
});
