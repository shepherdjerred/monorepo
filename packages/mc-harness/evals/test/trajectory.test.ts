import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { BlockGrid } from "@shepherdjerred/mc-build/core/grid.ts";
import { gridHash } from "@shepherdjerred/mc-build/core/site.ts";
import { writeSchematic } from "@shepherdjerred/mc-build/core/schem.ts";
import {
  acceptedNonDecreasing,
  critiquedIterations,
  readJournal,
  trajectoryChecks,
  trajectoryOf,
} from "#evals/grade/trajectory.ts";
import type { BuildLogEntry, JudgeRubric } from "#protocol/build.ts";
import { rubricAxisIds } from "#build/judge.ts";

const at = "2026-10-07T00:00:00.000Z";
const iterationGrid = (iteration: number) =>
  new BlockGrid({ x: iteration, y: 1, z: 1 });
const render = (iteration: number): BuildLogEntry => ({
  kind: "render",
  at,
  iteration,
  name: `iter-${iteration.toString()}`,
  source: "compiled",
  files: [],
});
const critique = (
  iteration: number,
  total: number,
  rubric: JudgeRubric = "micro",
): BuildLogEntry => ({
  kind: "critique",
  at,
  iteration,
  render: `iter-${iteration.toString()}`,
  gridHash: gridHash(iterationGrid(iteration)),
  rubric,
  file: `judge/critique-${iteration.toString()}.json`,
  total,
  max: 40,
  lowest: rubricAxisIds(rubric)[0] ?? "",
});
const accept = (
  iteration: number,
  score: number | null,
  rubric: JudgeRubric = "micro",
): BuildLogEntry => ({
  kind: "accept",
  at,
  iteration,
  candidate: "b",
  versus: "a",
  file: null,
  rubric,
  score,
  gridHash: gridHash(iterationGrid(iteration)),
  critique:
    score === null ? null : `judge/critique-${iteration.toString()}.json`,
});
const reject = (iteration: number): BuildLogEntry => ({
  kind: "reject",
  at,
  iteration,
  candidate: "a",
  versus: "b",
  file: null,
  rubric: "micro",
  score: null,
});
const checksOf = (entries: BuildLogEntry[]) =>
  trajectoryChecks({ entries }, "micro");

const temps: string[] = [];
afterAll(async () => {
  await Promise.all(temps.map((dir) => rm(dir, { recursive: true })));
});

async function writeEvidence(dir: string, entry: BuildLogEntry) {
  if (entry.kind !== "critique") throw new Error("expected critique fixture");
  const sheet = `judge/critique-${entry.iteration.toString()}.png`;
  const base = Math.floor(entry.total / 8);
  const record = {
    kind: "critique",
    at,
    iteration: entry.iteration,
    model: "stub",
    render: entry.render,
    rubric: entry.rubric,
    gridHash: entry.gridHash,
    total: entry.total,
    max: entry.max,
    lowest: entry.lowest,
    sheet,
    sheetHash: createHash("sha256")
      .update(new Uint8Array([1, 2, 3]))
      .digest("hex"),
    grid: `judge/grids/${entry.iteration.toString()}.schem`,
    axes: Object.fromEntries(
      rubricAxisIds(entry.rubric).map((id, index) => [
        id,
        base + (index > 0 && index <= entry.total % 8 ? 1 : 0),
      ]),
    ),
    overallAesthetic: base,
    notes: [],
    suggestions: [],
  };
  await Bun.write(path.join(dir, entry.file), JSON.stringify(record));
  await Bun.write(path.join(dir, sheet), new Uint8Array([1, 2, 3]));
  await Bun.write(
    path.join(dir, record.grid),
    writeSchematic(iterationGrid(entry.iteration), 3955),
  );
  return record;
}

describe("trajectory record validation", () => {
  it.each([
    "missing",
    "render",
    "iteration",
    "gridHash",
    "rubric",
    "total",
    "max",
    "lowest",
    "sheet",
    "sheet-bytes",
    "sheet-empty",
    "sheet-hash",
    "escape",
  ])(
    "rejects %s critique evidence before grading or publishing totals",
    async (field) => {
      const dir = await mkdtemp(path.join(tmpdir(), "trajectory-record-"));
      temps.push(dir);
      const entries = [render(1), critique(1, 20), render(2), critique(2, 26)];
      const first = entries[1];
      const second = entries[3];
      if (first?.kind !== "critique" || second?.kind !== "critique")
        throw new Error("missing fixtures");
      const record = await writeEvidence(dir, first);
      await writeEvidence(dir, second);
      await Bun.write(
        path.join(dir, "journal.jsonl"),
        entries.map((entry) => JSON.stringify(entry)).join("\n"),
      );
      expect(await readJournal(dir)).toEqual({ entries });
      const file = path.join(dir, first.file);
      switch (field) {
        case "missing":
          await rm(file);
          break;
        case "sheet":
          await rm(path.join(dir, record.sheet));
          break;
        case "sheet-bytes":
          await Bun.write(path.join(dir, record.sheet), "changed bytes");
          break;
        case "sheet-empty":
          await Bun.write(path.join(dir, record.sheet), new Uint8Array());
          break;
        case "sheet-hash":
          await Bun.write(
            file,
            JSON.stringify({ ...record, sheetHash: "0".repeat(64) }),
          );
          break;
        case "escape": {
          const outside = await mkdtemp(
            path.join(tmpdir(), "trajectory-outside-"),
          );
          temps.push(outside);
          const target = path.join(outside, "record.json");
          await Bun.write(target, JSON.stringify(record));
          await rm(file);
          await symlink(target, file);
          break;
        }
        default: {
          const values: Record<string, string | number> = {
            iteration: 2,
            total: 21,
            max: 41,
            rubric: "map",
          };
          const value = values[field] ?? "mismatch";
          await Bun.write(file, JSON.stringify({ ...record, [field]: value }));
        }
      }
      const journal = await readJournal(dir);
      expect(journal).toHaveProperty("error");
      expect(
        trajectoryChecks(journal, "micro").every((check) => !check.pass),
      ).toBe(true);
    },
  );
  it("does not count a copied critique as evaluating another rendered iteration", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "trajectory-copied-"));
    temps.push(dir);
    const original = critique(1, 20);
    const copied = { ...original, iteration: 2 };
    const entries = [render(1), original, render(2), copied];
    await writeEvidence(dir, original);
    await Bun.write(
      path.join(dir, "journal.jsonl"),
      entries.map((entry) => JSON.stringify(entry)).join("\n"),
    );
    expect(critiquedIterations(entries, "micro")).toBe(1);
    expect(checksOf(entries)[1]?.pass).toBe(false);
    const journal = await readJournal(dir);
    expect(journal).toHaveProperty("error");
    expect(
      trajectoryChecks(journal, "micro").every((check) => !check.pass),
    ).toBe(true);
  });
});

describe("trajectory", () => {
  it("grades only evidence after the latest site capture", () => {
    const capture: BuildLogEntry = {
      kind: "capture",
      at,
      iteration: 2,
      siteHash: "new-site",
      box: {
        world: "world",
        min: { x: 0, y: 0, z: 0 },
        max: { x: 9, y: 9, z: 9 },
      },
    };
    const previous = [
      render(1),
      critique(1, 20),
      accept(1, 20),
      render(2),
      critique(2, 30),
      accept(2, 30),
    ];
    expect(checksOf(previous)[1]?.pass).toBe(true);
    const recaptured = [
      ...previous,
      capture,
      render(3),
      critique(3, 10),
      accept(3, 10),
    ];
    expect(trajectoryOf(recaptured, "micro")).toEqual({
      iterations: 1,
      critiques: [10],
      accepted: 1,
      rejected: 0,
    });
    expect(checksOf(recaptured).map((check) => check.pass)).toEqual([
      true,
      false,
      true,
    ]);
    expect(
      critiquedIterations([...previous, capture, critique(1, 40)], "micro"),
    ).toBe(0);
    const current = [...recaptured, render(4), critique(4, 12), accept(4, 12)];
    expect(checksOf(current).map((check) => check.pass)).toEqual([
      true,
      true,
      true,
    ]);
    expect(acceptedNonDecreasing([...current, accept(4, 9)], "micro")).toBe(
      false,
    );
    expect(trajectoryOf([...current, capture], "micro")).toEqual({
      iterations: 0,
      critiques: [],
      accepted: 0,
      rejected: 0,
    });
  });

  it("counts iterations, critiques and knockout outcomes", () => {
    const entries = [
      render(1),
      critique(1, 20),
      render(2),
      critique(2, 26),
      accept(2, 26),
      reject(2),
    ];
    expect(trajectoryOf(entries, "micro")).toEqual({
      iterations: 2,
      critiques: [20, 26],
      accepted: 1,
      rejected: 1,
    });
    expect(acceptedNonDecreasing(entries, "micro")).toBe(true);
    expect(checksOf(entries).map((check) => check.pass)).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("fails an accepted step that scored lower than the last accepted one", () => {
    const entries = [
      render(1),
      critique(1, 30),
      accept(1, 30),
      render(2),
      critique(2, 22),
      accept(2, 22),
    ];
    expect(acceptedNonDecreasing(entries, "micro")).toBe(false);
    const checks = checksOf(entries);
    expect(checks[2]?.pass).toBe(false);
    expect(checks[1]?.detail).toBe("critiques: 30 → 22 over 2 iteration(s)");
  });

  it("counts iterations that were critiqued, not critiques", () => {
    // v1 and v2 rendered, v2 critiqued twice: one critiqued iteration.
    const twice = [render(1), render(2), critique(2, 20), critique(2, 22)];
    expect(critiquedIterations(twice, "micro")).toBe(1);
    expect(checksOf(twice)[1]?.pass).toBe(false);
    expect(
      critiquedIterations(
        [render(1), critique(1, 20), render(2), critique(2, 24)],
        "micro",
      ),
    ).toBe(2);
  });

  it("reads scores on the task's rubric only", () => {
    // A micro 35 followed by a map 30 is not a drop: the map total is a
    // different number, and a map critique does not count as a micro look.
    const entries = [
      render(1),
      critique(1, 35),
      accept(1, 35),
      render(2),
      critique(2, 30, "map"),
      accept(2, 30, "map"),
    ];
    expect(acceptedNonDecreasing(entries, "micro")).toBe(true);
    expect(trajectoryOf(entries, "micro")).toEqual({
      iterations: 2,
      critiques: [35],
      accepted: 1,
      rejected: 0,
    });
    expect(trajectoryOf(entries, "map").critiques).toEqual([30]);
    expect(critiquedIterations(entries, "micro")).toBe(1);
    expect(checksOf(entries)[1]?.pass).toBe(false);
    expect(trajectoryChecks({ entries }, "map")[1]?.pass).toBe(false);
  });

  it("fails every process check without a journal", () => {
    expect(trajectoryChecks(null, "micro").map((check) => check.pass)).toEqual([
      false,
    ]);
    expect(checksOf([render(1)])[1]?.pass).toBe(false);
  });

  it("reports a journal that does not parse as a failed check, not a crash", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "journal-"));
    temps.push(dir);
    expect(await readJournal(dir)).toBeNull();
    await Bun.write(
      path.join(dir, "journal.jsonl"),
      `${JSON.stringify(render(1))}\n{"kind":"render","at":"x"\n`,
    );
    const journal = await readJournal(dir);
    if (journal === null || !("error" in journal)) {
      throw new Error("expected a parse error");
    }
    expect(journal.error.length).toBeGreaterThan(0);
    const checks = trajectoryChecks(journal, "micro");
    expect(checks).toHaveLength(1);
    expect(checks[0]?.pass).toBe(false);
    expect(checks[0]?.detail).toMatch(/does not parse/u);
    // A whole journal reads back as its entries.
    await Bun.write(
      path.join(dir, "journal.jsonl"),
      `${JSON.stringify(render(1))}\n${JSON.stringify(critique(1, 20))}\n`,
    );
    await writeEvidence(dir, critique(1, 20));
    expect(await readJournal(dir)).toEqual({
      entries: [render(1), critique(1, 20)],
    });
  });

  it("judges each accepted candidate by its own score, not the latest critique", () => {
    // v1 scores 30; v2 scores 20 but the knockout keeps v1; v3 scores 25 and wins.
    const keptV1: BuildLogEntry = {
      kind: "accept",
      at,
      iteration: 2,
      candidate: "v1",
      versus: "v2",
      file: null,
      rubric: "micro",
      score: 30,
      gridHash: gridHash(iterationGrid(1)),
      critique: "judge/critique-1.json",
    };
    const entries = [
      render(1),
      critique(1, 30),
      accept(1, 30),
      render(2),
      critique(2, 20),
      keptV1,
      render(3),
      critique(3, 25),
      accept(3, 25),
    ];
    expect(acceptedNonDecreasing(entries, "micro")).toBe(false);
    // An accepted candidate that was never critiqued fails the rule.
    expect(
      acceptedNonDecreasing([accept(1, 30), accept(2, null)], "micro"),
    ).toBe(false);
  });
});
