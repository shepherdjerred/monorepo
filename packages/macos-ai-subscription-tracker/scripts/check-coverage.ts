import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");
const codecovPathResult = Bun.spawnSync(
  ["swift", "test", "--show-codecov-path"],
  {
    cwd: packageRoot,
    stdout: "pipe",
    stderr: "inherit",
  },
);
if (codecovPathResult.exitCode !== 0) process.exit(codecovPathResult.exitCode);

const codecovPath = codecovPathResult.stdout.toString().trim();
const coverage: unknown = JSON.parse(await Bun.file(codecovPath).text());
const coreMarker = "/Sources/QuotaBarCore/";
const files: Array<{ filename: string; count: number; covered: number }> = [];
for (const entry of arrayField(coverage, "data")) {
  for (const file of arrayField(entry, "files")) {
    const filename = stringField(file, "filename");
    if (!filename.includes(coreMarker)) continue;
    const summary = objectField(file, "summary");
    const lines = objectField(summary, "lines");
    files.push({
      filename,
      count: numberField(lines, "count"),
      covered: numberField(lines, "covered"),
    });
  }
}
if (files.length === 0)
  throw new Error("No QuotaBarCore coverage files found.");

const totals = files.reduce(
  (result, file) => ({
    count: result.count + file.count,
    covered: result.covered + file.covered,
  }),
  { count: 0, covered: 0 },
);
const percentage = (totals.covered / totals.count) * 100;
console.log(`QuotaBarCore line coverage: ${percentage.toFixed(2)}%`);
if (percentage < 80) {
  throw new Error(
    `QuotaBarCore coverage ${percentage.toFixed(2)}% is below 80%.`,
  );
}

function objectField(value: unknown, key: string): object {
  const field: unknown = Reflect.get(record(value, key), key);
  if (typeof field !== "object" || field === null)
    throw new Error(`Expected object field ${key}.`);
  return field;
}

function arrayField(value: unknown, key: string): unknown[] {
  const field: unknown = Reflect.get(record(value, key), key);
  if (!Array.isArray(field)) throw new Error(`Expected array field ${key}.`);
  return field;
}

function stringField(value: unknown, key: string): string {
  const field: unknown = Reflect.get(record(value, key), key);
  if (typeof field !== "string")
    throw new Error(`Expected string field ${key}.`);
  return field;
}

function numberField(value: unknown, key: string): number {
  const field: unknown = Reflect.get(record(value, key), key);
  if (typeof field !== "number" || !Number.isFinite(field)) {
    throw new Error(`Expected number field ${key}.`);
  }
  return field;
}

function record(value: unknown, key: string): object {
  if (typeof value !== "object" || value === null)
    throw new Error(`Expected object for ${key}.`);
  return value;
}
