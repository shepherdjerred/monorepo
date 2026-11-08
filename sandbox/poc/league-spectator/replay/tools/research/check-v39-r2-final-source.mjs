import { resolve } from "node:path";

const research = resolve(".cache/replay-spike/research"),
  beforePath = resolve(research, "v39-r2-source-final-before.json"),
  afterPath = resolve(research, "v39-r2-source-final-after.json"),
  reportPath = resolve(research, "v39-r2-tests-bundles-final-control.json"),
  testsPath = resolve(research, "v39-r2-tests-final.log"),
  bundlesPath = resolve(research, "v39-r2-bundles-final.log"),
  hash = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
for (const path of [beforePath, afterPath, reportPath, testsPath, bundlesPath])
  if (await Bun.file(path).exists())
    throw Error("Final verification output already exists: " + path);
async function snapshot() {
  const proc = Bun.spawn(
      [
        "rg",
        "--files",
        "sandbox/poc/league-spectator/replay",
        "-g",
        "*.mjs",
        "-g",
        "*.js",
        "-g",
        "*.ts",
        "-g",
        "*.py",
        "-g",
        "*.html",
        "-g",
        "*.json",
        "-g",
        "*.md",
      ],
      { stdout: "pipe", stderr: "inherit" },
    ),
    names = (await new Response(proc.stdout).text())
      .trim()
      .split(/\r?\n/)
      .sort();
  if ((await proc.exited) !== 0 || names.length < 1500)
    throw Error("Whole spike source inventory required");
  const files = {};
  for (const path of names) files[path] = hash(await Bun.file(path).bytes());
  return { schema: 1, kind: "whole-spike-v39-r2-final-source-snapshot", files };
}
const before = await snapshot();
await Bun.write(beforePath, JSON.stringify(before, null, 2));
const commands = [
    {
      args: [process.execPath, "test", "sandbox/poc/league-spectator/replay"],
      output: testsPath,
    },
    {
      args: [
        process.execPath,
        "sandbox/poc/league-spectator/replay/tools/check-direct-effect-bundles.mjs",
      ],
      output: bundlesPath,
    },
  ],
  results = [];
for (const command of commands) {
  const sink = Bun.file(command.output).writer(),
    proc = Bun.spawn(command.args, { stdout: "pipe", stderr: "pipe" });
  async function copy(stream) {
    for await (const bytes of stream) sink.write(bytes);
  }
  await Promise.all([copy(proc.stdout), copy(proc.stderr)]);
  const exitCode = await proc.exited;
  await sink.end();
  results.push({
    ...command,
    exitCode,
    sha256: hash(await Bun.file(command.output).bytes()),
  });
  console.log(JSON.stringify({ output: command.output, exitCode }));
  if (exitCode !== 0) break;
}
const after = await snapshot();
await Bun.write(afterPath, JSON.stringify(after, null, 2));
const paths = new Set([
    ...Object.keys(before.files),
    ...Object.keys(after.files),
  ]),
  changed = [...paths].filter(
    (path) => before.files[path] !== after.files[path],
  );
const report = {
  schema: 1,
  kind: "whole-spike-v39-r2-tests-three-browser-bundles-source-stability-control",
  before: {
    path: beforePath,
    sha256: hash(await Bun.file(beforePath).bytes()),
    files: Object.keys(before.files).length,
  },
  after: {
    path: afterPath,
    sha256: hash(await Bun.file(afterPath).bytes()),
    files: Object.keys(after.files).length,
  },
  results,
  changed,
  pass:
    results.length === 2 &&
    results.every((r) => r.exitCode === 0) &&
    changed.length === 0,
  scope: {
    wholeSpikeUnitTests: true,
    threeBrowserBundles: true,
    bothSimulationWorkersEmulationFree: true,
    browserPerformance: false,
  },
};
await Bun.write(reportPath, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    output: reportPath,
    pass: report.pass,
    sourceFiles: report.before.files,
    changed,
  }),
);
if (!report.pass) throw Error("Final checks failed or source drifted");
