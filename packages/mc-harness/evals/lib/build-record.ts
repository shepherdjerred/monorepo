import { cp, mkdir, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { readSchematic } from "@shepherdjerred/mc-build/core/schem.ts";
import { gridHash } from "@shepherdjerred/mc-build/core/site.ts";
import { JudgeRecordSchema, type JudgeRecord } from "#protocol/build.ts";

/** Resolve symlinks before accepting any caller-controlled artifact path. */
async function allowedFile(file: string, root: string): Promise<string> {
  const absolute = await realpath(file);
  const relative = path.relative(root, absolute);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`build record input is outside allowed root: ${file}`);
  }
  return absolute;
}

/** Resolve inputs against their owning build, including references into another build. */
async function portableRecord(
  record: JudgeRecord,
  options: {
    source: string;
    destination: string;
    kept: Set<string>;
    root: string;
  },
): Promise<JudgeRecord> {
  const { source, destination, kept, root } = options;
  const input = async (
    file: string,
    expectedHash?: string,
    kind: "png" | "schem" = "png",
  ): Promise<string> => {
    const absolute = await allowedFile(path.resolve(source, file), root);
    const bytes = await Bun.file(absolute).bytes();
    const relative = path.relative(path.resolve(source), absolute);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const schematic = kind === "schem" ? await readSchematic(bytes) : null;
    const identity = schematic === null ? hash : gridHash(schematic.grid);
    if (expectedHash !== undefined && identity !== expectedHash)
      throw new Error(`build record input hash does not match: ${file}`);
    const archived =
      path.dirname(relative) === "judge"
        ? relative
        : path.join(
            "judge",
            kind === "png" ? "inputs" : "grids",
            `${hash}.${kind}`,
          );
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
      return {
        ...record,
        sheet: await input(record.sheet, record.sheetHash),
        grid: await input(record.grid, record.gridHash, "schem"),
      };
  }
}

/** Preserve a build's journal, verdicts and exact judge inputs through each eval/archive copy. */
export async function keepBuildRecord(
  source: string,
  destination: string,
  options: { allowedRoot?: string } = {},
): Promise<string[]> {
  const root = await realpath(options.allowedRoot ?? source);
  const owner = await allowedFile(source, root);
  const kept = new Set<string>();
  const journal = path.join(owner, "journal.jsonl");
  if (await Bun.file(journal).exists()) {
    await mkdir(destination, { recursive: true });
    const out = path.join(destination, "journal.jsonl");
    await cp(await allowedFile(journal, root), out);
    kept.add(out);
  }
  let names: string[];
  try {
    names = await readdir(path.join(owner, "judge"));
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
    const original = await allowedFile(path.join(owner, "judge", name), root);
    if (name.endsWith(".json")) {
      const record = JudgeRecordSchema.parse(await Bun.file(original).json());
      const portable = await portableRecord(record, {
        source: owner,
        destination,
        kept,
        root,
      });
      await Bun.write(out, `${JSON.stringify(portable)}\n`);
    } else {
      await cp(original, out);
    }
    kept.add(out);
  }
  return [...kept];
}
