import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { keepBuildRecord } from "#evals/lib/build-record.ts";
import { JudgeRecordSchema } from "#protocol/build.ts";

const pair = (a: string, b: string) => ({
  kind: "pair",
  at: "2026-10-10T00:00:00Z",
  model: "stub",
  rubric: "micro",
  judge: "test-judge",
  a,
  b,
  winner: "a",
  confidence: 0.9,
  agreed: true,
  reasons: ["test"],
});

it("keeps portable verdict inputs through eval and benchmark copies", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mc-build-record-"));
  try {
    const source = path.join(root, "build");
    const task = path.join(root, "eval");
    const archive = path.join(root, "benchmark");
    const input = "judge/candidate-original-abc.png";
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10]);
    const record = pair(input, input);
    await Bun.write(path.join(source, input), bytes);
    await Bun.write(
      path.join(source, "judge/pair.json"),
      JSON.stringify(record),
    );
    await Bun.write(path.join(source, "journal.jsonl"), "original journal\n");
    await Bun.write(
      path.join(source, "judge/unrelated.txt"),
      "not an artifact",
    );
    expect(await keepBuildRecord(source, task)).toHaveLength(3);
    expect(await keepBuildRecord(task, archive)).toHaveLength(3);
    await rm(source, { recursive: true });
    await rm(task, { recursive: true });
    expect(
      await Bun.file(path.join(archive, "judge/pair.json")).json(),
    ).toEqual(record);
    expect(
      new Uint8Array(await Bun.file(path.join(archive, input)).arrayBuffer()),
    ).toEqual(bytes);
    expect(await Bun.file(path.join(archive, "journal.jsonl")).text()).toBe(
      "original journal\n",
    );
    expect(
      await Bun.file(path.join(archive, "judge/unrelated.txt")).exists(),
    ).toBe(false);
  } finally {
    await rm(root, { recursive: true });
  }
});

it("copies absolute and cross-build judge inputs and rewrites every archive hop", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mc-build-record-external-"));
  try {
    const source = path.join(root, "build");
    const other = path.join(root, "other-build", "judge", "same-name.png");
    const own = path.join(source, "judge", "same-name.png");
    const task = path.join(root, "eval");
    const archive = path.join(root, "benchmark");
    await Bun.write(own, "own input");
    await Bun.write(other, "other input");
    await Bun.write(
      path.join(source, "judge/pair.json"),
      JSON.stringify(pair(own, other)),
    );
    await Bun.write(
      path.join(source, "judge/absolute.json"),
      JSON.stringify({
        kind: "absolute",
        at: "2026-10-10T00:00:00Z",
        model: "stub",
        rubric: "micro",
        judge: "test-scorer",
        render: other,
        axes: {},
        overallAesthetic: 1,
        total: 1,
        max: 40,
        notes: [],
      }),
    );
    await keepBuildRecord(source, task, { allowedRoot: root });
    await keepBuildRecord(task, archive);
    await rm(source, { recursive: true });
    await rm(path.join(root, "other-build"), { recursive: true });
    await rm(task, { recursive: true });
    const keptPair = JudgeRecordSchema.parse(
      await Bun.file(path.join(archive, "judge/pair.json")).json(),
    );
    const absolute = JudgeRecordSchema.parse(
      await Bun.file(path.join(archive, "judge/absolute.json")).json(),
    );
    if (keptPair.kind !== "pair" || absolute.kind !== "absolute")
      throw new Error("wrong verdict kind");
    expect(path.isAbsolute(keptPair.a)).toBe(false);
    expect(path.isAbsolute(keptPair.b)).toBe(false);
    expect(await Bun.file(path.join(archive, keptPair.a)).text()).toBe(
      "own input",
    );
    expect(await Bun.file(path.join(archive, keptPair.b)).text()).toBe(
      "other input",
    );
    expect(await Bun.file(path.join(archive, absolute.render)).text()).toBe(
      "other input",
    );
  } finally {
    await rm(root, { recursive: true });
  }
});

it("keeps generated input paths separate from source filenames through two archive hops", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mc-record-collision-"));
  try {
    const source = path.join(root, "build");
    const task = path.join(root, "eval");
    const archive = path.join(root, "benchmark");
    const external = path.join(root, "other", "input.png");
    const externalBytes = "exact external judge input";
    const hash = createHash("sha256").update(externalBytes).digest("hex");
    const own = `judge/input-${hash}.png`;
    await Bun.write(external, externalBytes);
    await Bun.write(path.join(source, own), "different source image");
    await Bun.write(
      path.join(source, "judge/a-pair.json"),
      JSON.stringify(pair(external, own)),
    );
    await keepBuildRecord(source, task, { allowedRoot: root });
    await keepBuildRecord(task, archive);
    for (const directory of [source, task, path.join(root, "other")]) {
      await rm(directory, { recursive: true });
    }
    const record = JudgeRecordSchema.parse(
      await Bun.file(path.join(archive, "judge/a-pair.json")).json(),
    );
    if (record.kind !== "pair") throw new Error("wrong verdict kind");
    expect(record.a).toBe(`judge/inputs/${hash}.png`);
    expect(record.b).toBe(own);
    expect(await Bun.file(path.join(archive, record.a)).text()).toBe(
      externalBytes,
    );
    expect(await Bun.file(path.join(archive, record.b)).text()).toBe(
      "different source image",
    );
  } finally {
    await rm(root, { recursive: true });
  }
});

it.each(["a", "b", "render", "sheet"] as const)(
  "rejects external %s judge inputs, including symlinks",
  async (field) => {
    const root = await mkdtemp(path.join(tmpdir(), "mc-record-boundary-"));
    try {
      const allowed = path.join(root, "worktree");
      const source = path.join(allowed, "build");
      const outside = path.join(root, "outside.txt");
      const own = path.join(source, "judge/own.png");
      await Bun.write(own, "own input");
      await Bun.write(outside, "private fixture outside worktree");
      const link = path.join(source, "escaped.png");
      await symlink(outside, link);
      for (const file of [outside, path.relative(source, outside), link]) {
        const score = {
          at: "2026-10-10T00:00:00Z",
          model: "stub",
          rubric: "micro",
          axes: {},
          overallAesthetic: 1,
          total: 1,
          max: 40,
          notes: [],
        };
        const record =
          field === "a" || field === "b"
            ? { ...pair(own, own), [field]: file }
            : field === "render"
              ? { ...score, kind: "absolute", judge: "test", render: file }
              : {
                  ...score,
                  kind: "critique",
                  render: "look",
                  sheet: file,
                  gridHash: "abc",
                  lowest: "depth",
                  suggestions: [],
                };
        await Bun.write(
          path.join(source, "judge/record.json"),
          JSON.stringify(record),
        );
        await expect(
          keepBuildRecord(source, path.join(root, "archive"), {
            allowedRoot: allowed,
          }),
        ).rejects.toThrow(/outside allowed root/u);
      }
    } finally {
      await rm(root, { recursive: true });
    }
  },
);
