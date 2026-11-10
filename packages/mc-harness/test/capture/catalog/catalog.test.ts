import { it, expect } from "vitest";
import { rm, symlink } from "node:fs/promises";
import path from "node:path";
import { auditCatalog, publicFile } from "#src/capture/suite/catalog/audit.ts";
import {
  reviewCatalog,
  sampleFrames,
} from "#src/capture/suite/catalog/review.ts";
import { phase } from "#src/capture/suite/progress.ts";
import { command } from "#src/capture/suite/process.ts";
import type { Annotation } from "#protocol/media.ts";
import { shot, suite, manifest, fixture } from "./fixtures.ts";

it("builds portable escaped reports without changing public assets and refuses overwrite", async () => {
  await fixture(async (root) => {
    const catalog = await auditCatalog(suite, root);
    expect(catalog.issues).toEqual([]);
    const output = path.join(root, "report");
    const result = await reviewCatalog(catalog, root, output);
    expect(result).toMatchObject({ shots: 1, cards: 1, sheets: 1 });
    const html = await Bun.file(path.join(output, "index.html")).text();
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(
      await Bun.file(
        path.join(output, "media/test-shot/original.webp"),
      ).exists(),
    ).toBe(true);
    expect(
      await Bun.file(path.join(root, "media/test-shot/media.json")).json(),
    ).toEqual(manifest);
    await expect(reviewCatalog(catalog, root, output)).rejects.toThrow(
      "must be empty",
    );
  });
});

it("aggregates missing files, metadata drift and stale aliases", async () => {
  await fixture(async (root) => {
    await Bun.write(
      path.join(root, "media/test-shot/media.json"),
      JSON.stringify({ ...manifest, caption: "stale" }),
    );
    await Bun.write(path.join(root, "screenshots/test.webp"), "wrong");
    const drift = await auditCatalog(suite, root);
    expect(drift.issues).toHaveLength(2);
    expect(drift.issues.map((i) => i.message).join(" ")).toMatch(
      /caption.*Legacy/su,
    );
    await Bun.write(
      path.join(root, "media/test-shot/media.json"),
      JSON.stringify(manifest),
    );
    await rm(path.join(root, "media/test-shot/original.webp"));
    const missing = await auditCatalog(suite, root);
    expect(missing.issues).toHaveLength(2);
    await Bun.write(path.join(root, "media/test-shot/media.json"), "{}");
    const malformed = await auditCatalog(suite, root);
    expect(malformed.entries).toHaveLength(0);
  });
});

it("checks annotation geometry and selection, and rejects linked public inputs", async () => {
  await fixture(async (root) => {
    const cue = {
      kind: "label",
      text: "bad",
      from: [0.5, 0.5],
      to: [0.5, 0.5],
      startMs: 0,
      endMs: 100,
    };
    await Bun.write(
      path.join(root, "media/test-shot/media.json"),
      JSON.stringify({ ...manifest, annotations: [cue] }),
    );
    const geometry = await auditCatalog(suite, root, { shot: shot.name });
    expect(geometry.issues[0]?.message).toContain("geometry");
    await expect(
      auditCatalog(suite, root, { shot: "unknown" }),
    ).rejects.toThrow("No capture scenarios");
    await symlink(
      path.join(root, "screenshots/test.webp"),
      path.join(root, "linked.webp"),
    );
    await expect(publicFile(root, "linked.webp")).rejects.toThrow("Linked");
    await expect(publicFile(root, "../private.json")).rejects.toThrow(
      "Invalid",
    );
  });
});

it("samples cue midpoints and clip boundaries once per frame", () => {
  expect(sampleFrames(1, [])).toEqual([0]);
  expect(sampleFrames(30, [])).toEqual([0, 14, 29]);
  const cue: Annotation = {
    kind: "label" as const,
    text: "Cue",
    from: [0, 0],
    to: [1, 1],
    startMs: 0,
    endMs: 1000,
  };
  expect(sampleFrames(30, [cue, cue])).toEqual([0, 14, 15, 29]);
  expect(() => sampleFrames(0, [])).toThrow();
});

it("propagates phase success/failure and forwards child stderr without polluting JSON", async () => {
  expect(await phase("test", () => Promise.resolve(42))).toBe(42);
  await expect(
    phase("failure", () => Promise.reject(new Error("original"))),
  ).rejects.toThrow("original");
  const output = await command(
    [
      "bun",
      "-e",
      'console.error("phase evidence");console.log(JSON.stringify({ok:true}))',
    ],
    undefined,
    { progress: true },
  );
  expect(JSON.parse(output)).toEqual({ ok: true });
});

it("keeps the CLI JSON contract and rejects invalid selectors/options", async () => {
  const cli = path.resolve(import.meta.dirname, "../../../src/capture/cli.ts");
  for (const [args, expected] of [
    [["--shot", "cooking-pot"], 0],
    [["--shot", "unknown-shot"], 1],
    [["--out", "/tmp/unused-catalog-output"], 1],
  ] as const) {
    const child = Bun.spawn(["bun", cli, "suite", "audit", "tsmc", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code).toBe(expected);
    if (code === 0)
      expect(JSON.parse(out)).toMatchObject({ suite: "tsmc", issues: [] });
    else {
      expect(out).toBe("");
      expect(err.length).toBeGreaterThan(0);
    }
  }
});
