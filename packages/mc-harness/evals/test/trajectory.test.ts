import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  acceptedNonDecreasing,
  critiquedIterations,
  readJournal,
  trajectoryChecks,
  trajectoryOf,
} from "#evals/grade/trajectory.ts";
import type { BuildLogEntry, JudgeRubric } from "#protocol/build.ts";

const at = "2026-10-07T00:00:00.000Z";
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
  gridHash: `grid-${iteration.toString()}`,
  rubric,
  file: "judge/critique.json",
  total,
  max: 40,
  lowest: "depth",
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
