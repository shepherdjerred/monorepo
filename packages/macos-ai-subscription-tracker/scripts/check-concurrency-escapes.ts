import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");
const manifestPath = resolve(packageRoot, "concurrency-escapes.json");
const manifest: unknown = JSON.parse(await Bun.file(manifestPath).text());
const expected = new Map<string, number>();

for (const entry of entries(manifest)) {
  if (expected.has(entry.path)) {
    throw new Error(`Duplicate concurrency escape entry: ${entry.path}`);
  }
  expected.set(entry.path, entry.count);
}

const actual = new Map<string, number>();
for (const directory of ["Sources", "Tests"]) {
  const glob = new Bun.Glob(`${directory}/**/*.swift`);
  for await (const path of glob.scan({ cwd: packageRoot })) {
    const content = await Bun.file(resolve(packageRoot, path)).text();
    const count = content.match(/@unchecked\s+Sendable/g)?.length ?? 0;
    if (count > 0) actual.set(path, count);
  }
}

const mismatches: string[] = [];
for (const [path, count] of actual) {
  if (expected.get(path) !== count) {
    mismatches.push(
      `${path}: found ${count}, expected ${expected.get(path) ?? 0}`,
    );
  }
}
for (const [path, count] of expected) {
  if (actual.get(path) !== count && !actual.has(path)) {
    mismatches.push(`${path}: found 0, expected ${count}`);
  }
}
if (mismatches.length > 0) {
  throw new Error(
    `Unchecked Sendable inventory changed:\n${mismatches.join("\n")}`,
  );
}

console.log(`Verified ${actual.size} checked @unchecked Sendable locations.`);

function entries(value: unknown): Array<{ path: string; count: number }> {
  const rawEntries = field(record(value), "entries");
  if (!Array.isArray(rawEntries)) throw new Error("Expected entries array.");
  return rawEntries.map((entry) => {
    const item = record(entry);
    const path = field(item, "path");
    const count = field(item, "count");
    const rationale = field(item, "rationale");
    if (typeof path !== "string" || path.length === 0) {
      throw new Error("Expected non-empty entry path.");
    }
    if (!Number.isSafeInteger(count) || count < 1) {
      throw new Error(`Expected positive count for ${path}.`);
    }
    if (typeof rationale !== "string" || rationale.length === 0) {
      throw new Error(`Expected rationale for ${path}.`);
    }
    return { path, count };
  });
}

function field(value: object, key: string): unknown {
  return Reflect.get(value, key);
}

function record(value: unknown): object {
  if (typeof value !== "object" || value === null) {
    throw new Error("Expected object.");
  }
  return value;
}
