import { createHash } from "node:crypto";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readJournal, trajectoryChecks } from "#evals/grade/trajectory.ts";
import type { BuildLogEntry } from "#protocol/build.ts";

const root = await mkdtemp(path.join(tmpdir(), "trajectory-pair-"));
afterAll(async () => rm(root, { recursive: true }));
const at = "2026-10-10T00:00:00Z";

async function fixture(
  dir: string,
  kind: "accept" | "reject",
  winner: "a" | "b" | "tie" = "b",
) {
  const input = async (candidate: string) => {
    const bytes = `immutable ${candidate} input`;
    const hash = createHash("sha256").update(bytes).digest("hex");
    const file = `judge/candidate-${candidate}-${hash}.png`;
    await Bun.write(path.join(dir, file), bytes);
    return file;
  };
  const record = {
    kind: "pair",
    at,
    model: "stub",
    rubric: "micro",
    judge: "fixture",
    a: await input("a"),
    b: await input("b"),
    winner,
    confidence: 1,
    agreed: true,
    reasons: [],
  };
  const kept = winner === "b" ? "b" : "a";
  const dropped = winner === "b" ? "a" : "b";
  const entry: BuildLogEntry = {
    kind,
    at,
    iteration: 2,
    candidate: kind === "accept" ? kept : dropped,
    versus: kind === "accept" ? dropped : kept,
    file: "judge/pair.json",
    rubric: "micro",
    score: null,
  };
  await Bun.write(path.join(dir, "judge/pair.json"), JSON.stringify(record));
  await Bun.write(path.join(dir, "journal.jsonl"), JSON.stringify(entry));
  return { record, entry };
}

describe("tournament trajectory evidence", () => {
  it.each(
    ["accept", "reject"].flatMap((kind) =>
      ["a", "b", "tie"].map((winner) => ({ kind, winner })),
    ),
  )(
    "validates $kind evidence for a $winner verdict",
    async ({ kind, winner }) => {
      if (
        (kind !== "accept" && kind !== "reject") ||
        (winner !== "a" && winner !== "b" && winner !== "tie")
      )
        throw new Error("invalid fixture");
      const dir = path.join(root, `valid-${kind}-${winner}`);
      const { entry } = await fixture(dir, kind, winner);
      expect(await readJournal(dir)).toEqual({ entries: [entry] });
    },
  );

  it.each(
    ["accept", "reject"].flatMap((kind) =>
      [
        "missing",
        "kind",
        "rubric",
        "winner",
        "candidate",
        "versus",
        "missing-a",
        "missing-b",
        "bytes",
        "record-escape",
        "image-escape",
      ].map((failure) => ({ kind, failure })),
    ),
  )(
    "rejects $failure evidence before counting $kind",
    async ({ kind, failure }) => {
      if (kind !== "accept" && kind !== "reject")
        throw new Error("invalid fixture");
      const dir = path.join(root, `${kind}-${failure}`);
      const { record, entry } = await fixture(dir, kind);
      const file = path.join(dir, "judge/pair.json");
      switch (failure) {
        case "missing":
          await rm(file);
          break;
        case "kind":
          await Bun.write(
            file,
            JSON.stringify({ ...record, kind: "critique" }),
          );
          break;
        case "rubric":
          await Bun.write(file, JSON.stringify({ ...record, rubric: "map" }));
          break;
        case "winner":
          await Bun.write(file, JSON.stringify({ ...record, winner: "a" }));
          break;
        case "candidate":
        case "versus":
          await Bun.write(
            path.join(dir, "journal.jsonl"),
            JSON.stringify({ ...entry, [failure]: "third" }),
          );
          break;
        case "missing-a":
          await rm(path.join(dir, record.a));
          break;
        case "missing-b":
          await rm(path.join(dir, record.b));
          break;
        case "bytes":
          await Bun.write(path.join(dir, record.a), "replacement input");
          break;
        case "record-escape": {
          const outside = path.join(root, `${kind}-outside.json`);
          await Bun.write(outside, JSON.stringify(record));
          await rm(file);
          await symlink(outside, file);
          break;
        }
        case "image-escape": {
          const outside = path.join(root, `${kind}-outside.png`);
          await Bun.write(
            outside,
            await Bun.file(path.join(dir, record.a)).bytes(),
          );
          await rm(path.join(dir, record.a));
          await symlink(outside, path.join(dir, record.a));
          break;
        }
        default:
          throw new Error("unknown fixture failure");
      }
      const journal = await readJournal(dir);
      expect(journal).toHaveProperty("error");
      expect(
        trajectoryChecks(journal, "micro").every((check) => !check.pass),
      ).toBe(true);
    },
  );

  it("retains missing historical verdicts outside the current capture", async () => {
    const dir = path.join(root, "historical");
    const { entry } = await fixture(dir, "accept");
    await rm(path.join(dir, "judge/pair.json"));
    const capture: BuildLogEntry = {
      kind: "capture",
      at,
      iteration: 2,
      siteHash: "new",
      box: {
        world: "world",
        min: { x: 0, y: 0, z: 0 },
        max: { x: 2, y: 2, z: 2 },
      },
    };
    await Bun.write(
      path.join(dir, "journal.jsonl"),
      [entry, capture].map((value) => JSON.stringify(value)).join("\n"),
    );
    expect(await readJournal(dir)).toEqual({ entries: [entry, capture] });
  });
});
