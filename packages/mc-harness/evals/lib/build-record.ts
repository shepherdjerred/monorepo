import { cp, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { JudgeRecordSchema, type JudgeRecord } from "#protocol/build.ts";

/** Resolve inputs against their owning build, including references into another build. */
async function portableRecord(
  record: JudgeRecord,
  source: string,
  destination: string,
  kept: Set<string>,
): Promise<JudgeRecord> {
  const input = async (file: string): Promise<string> => {
    const absolute = path.resolve(source, file);
    const bytes = await Bun.file(absolute).bytes();
    const relative = path.relative(path.resolve(source), absolute);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const archived =
      path.dirname(relative) === "judge"
        ? relative
        : path.join("judge", `input-${hash}.png`);
    const out = path.join(destination, archived);
    await Bun.write(out, bytes);
    kept.add(out);
    return archived;
  };
  switch (record.kind) {
    case "pair":
      return { ...record, a: await input(record.a), b: await input(record.b) };
    case "absolute":
      return { ...record, render: await input(record.render) };
    case "critique":
      return { ...record, sheet: await input(record.sheet) };
  }
}

/** Preserve a build's journal, verdicts and exact judge inputs through each eval/archive copy. */
export async function keepBuildRecord(
  source: string,
  destination: string,
): Promise<string[]> {
  const kept = new Set<string>();
  const journal = path.join(source, "journal.jsonl");
  if (await Bun.file(journal).exists()) {
    await mkdir(destination, { recursive: true });
    const out = path.join(destination, "journal.jsonl");
    await cp(journal, out);
    kept.add(out);
  }
  let names: string[];
  try {
    names = await readdir(path.join(source, "judge"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return [...kept];
    throw error;
  }
  const wanted = names.filter(
    (name) => name.endsWith(".json") || name.endsWith(".png"),
  );
  if (wanted.length === 0) return [...kept];
  await mkdir(path.join(destination, "judge"), { recursive: true });
  for (const name of wanted) {
    const out = path.join(destination, "judge", name);
    const original = path.join(source, "judge", name);
    if (name.endsWith(".json")) {
      const record = JudgeRecordSchema.parse(await Bun.file(original).json());
      const portable = await portableRecord(record, source, destination, kept);
      await Bun.write(out, `${JSON.stringify(portable)}\n`);
    } else {
      await cp(original, out);
    }
    kept.add(out);
  }
  return [...kept];
}
