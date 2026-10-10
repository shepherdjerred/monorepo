import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { keepBuildRecord } from "#evals/lib/build-record.ts";

it("keeps portable verdict inputs through eval and benchmark copies", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mc-build-record-"));
  try {
    const source = path.join(root, "build");
    const task = path.join(root, "eval");
    const archive = path.join(root, "benchmark");
    const input = "judge/candidate-original-abc.png";
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10]);
    const record = JSON.stringify({ a: input, b: input });
    await Bun.write(path.join(source, input), bytes);
    await Bun.write(path.join(source, "judge/pair.json"), record);
    await Bun.write(path.join(source, "journal.jsonl"), "original journal\n");
    await Bun.write(
      path.join(source, "judge/unrelated.txt"),
      "not an artifact",
    );
    expect(await keepBuildRecord(source, task)).toHaveLength(3);
    expect(await keepBuildRecord(task, archive)).toHaveLength(3);
    await rm(source, { recursive: true });
    await rm(task, { recursive: true });
    expect(await Bun.file(path.join(archive, "judge/pair.json")).text()).toBe(
      record,
    );
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
