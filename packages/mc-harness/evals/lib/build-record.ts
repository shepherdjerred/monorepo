import { cp, mkdir, readdir } from "node:fs/promises";
import path from "node:path";

/** Preserve a build's journal, verdicts and exact judge inputs through each eval/archive copy. */
export async function keepBuildRecord(
  source: string,
  destination: string,
): Promise<string[]> {
  const kept: string[] = [];
  const journal = path.join(source, "journal.jsonl");
  if (await Bun.file(journal).exists()) {
    await mkdir(destination, { recursive: true });
    const out = path.join(destination, "journal.jsonl");
    await cp(journal, out);
    kept.push(out);
  }
  let names: string[];
  try {
    names = await readdir(path.join(source, "judge"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return kept;
    throw error;
  }
  const wanted = names.filter(
    (name) => name.endsWith(".json") || name.endsWith(".png"),
  );
  if (wanted.length === 0) return kept;
  await mkdir(path.join(destination, "judge"), { recursive: true });
  for (const name of wanted) {
    const out = path.join(destination, "judge", name);
    await cp(path.join(source, "judge", name), out);
    kept.push(out);
  }
  return kept;
}
