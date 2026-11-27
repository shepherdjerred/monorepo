import { readdir, stat } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { buildAllGameFacts, gameFactFile } from "#src/game-facts/build.ts";
import { GameFactSchema, type GameFactKind } from "#src/game-facts/schema.ts";
import { loadGameFactSources } from "#src/game-facts/sources.ts";

const FACTS_ROOT = `${import.meta.dirname}/../data-dragon/assets/facts`;
const SCOUT_ROOT = `${import.meta.dirname}/../../../..`;

const SAMPLES: readonly (readonly [GameFactKind, string])[] = [
  ["champion", "Ahri"],
  ["ability", "Ahri-E"],
  ["item", "3118"],
  ["rune", "8112"],
  ["summoner-spell", "14"],
];

async function listFiles(): Promise<string[]> {
  const entries = await readdir(FACTS_ROOT, { recursive: true });
  const files: string[] = [];
  for (const entry of entries) {
    const info = await stat(`${FACTS_ROOT}/${entry}`);
    if (info.isFile()) files.push(entry);
  }
  return files.toSorted();
}

describe("committed game fact files", () => {
  test.each(SAMPLES)(
    "%s %s is emitted and parses as itself",
    async (kind, key) => {
      const file = Bun.file(`${FACTS_ROOT}/${kind}/${key}.json`);
      const fact = GameFactSchema.parse(await file.json());
      expect(fact.kind).toBe(kind);
      expect(fact.key).toBe(key);
    },
  );

  test("match what the builders generate, with no stale files", async () => {
    const generated = buildAllGameFacts(await loadGameFactSources()).map(
      (fact) => gameFactFile(fact),
    );
    expect(await listFiles()).toEqual(
      generated.map((file) => file.path.slice("facts/".length)).toSorted(),
    );
    for (const file of generated) {
      const onDisk = await Bun.file(
        `${FACTS_ROOT}/${file.path.slice("facts/".length)}`,
      ).text();
      expect(onDisk, file.path).toBe(file.content);
    }
  });

  test("emit one file per champion, ability, item, rune and spell", async () => {
    const counts = new Map<string, number>();
    for (const file of await listFiles()) {
      const kind = file.split("/")[0] ?? "";
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    expect(counts.get("ability")).toBe((counts.get("champion") ?? 0) * 5);
    expect(counts.get("rune")).toBeGreaterThan(50);
    expect(counts.get("summoner-spell")).toBeGreaterThan(10);
    expect(counts.get("item")).toBeGreaterThan(500);
    // One keyword file per tips glossary entry, none before a glossary exists.
    const sources = await loadGameFactSources();
    expect(counts.get("keyword") ?? 0).toBe(sources.keywords.length);
  });

  test("stay within the asset size budget", async () => {
    const proc = Bun.spawn(["bun", "run", "scripts/check-asset-sizes.ts"], {
      cwd: SCOUT_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    expect(await proc.exited, stderr).toBe(0);
    expect(stdout).toContain("within size limits");
  });
});
