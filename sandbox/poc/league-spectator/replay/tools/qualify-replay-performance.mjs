import { open, lstat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { qualifyReplayPerformance } from "../replay-performance-qualification.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const hash = (bytes) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

/** Local private inputs only. Outputs are create-only and never sent to a publisher. */
export async function runReplayPerformanceQualification(inputFile, outputFile) {
  const inputs = {},
    input = resolve(inputFile),
    output = resolve(outputFile);
  const read = async (filename, maximum = 512 * 1024 * 1024) => {
    filename = resolve(filename);
    const stats = await lstat(filename);
    if (!stats.isFile() || stats.size <= 0 || stats.size > maximum)
      throw Error(
        "Regular bounded performance evidence file required: " + filename,
      );
    const bytes = await Bun.file(filename).bytes();
    if (bytes.length !== stats.size)
      throw Error("Performance input changed while reading: " + filename);
    const sha256 = hash(bytes);
    if (Object.hasOwn(inputs, filename) && inputs[filename] !== sha256)
      throw Error("Performance input changed: " + filename);
    inputs[filename] = sha256;
    return bytes;
  };
  const json = (bytes) =>
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  await captureDirectSourceInputs([import.meta.path], read);
  const request = json(await read(input, 1024 * 1024));
  if (
    request.schemaVersion !== 1 ||
    request.kind !== "private-replay-performance-request" ||
    !Array.isArray(request.runs)
  )
    throw Error("Versioned private performance request required");
  const recordings = [];
  for (const run of request.runs) {
    if (
      typeof run.file !== "string" ||
      !run.file ||
      typeof run.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(run.sha256)
    )
      throw Error("Explicit raw recording file and SHA-256 required");
    const bytes = await read(resolve(dirname(input), run.file));
    if (hash(bytes) !== run.sha256)
      throw Error("Raw recording SHA-256 does not match request");
    recordings.push({ rate: run.rate, recording: json(bytes) });
  }
  const result = qualifyReplayPerformance(request.subject, recordings);
  if (Object.hasOwn(inputs, output))
    throw Error("Qualification must preserve every source input");
  for (const [filename, expected] of Object.entries(inputs))
    if (hash(await Bun.file(filename).bytes()) !== expected)
      throw Error(
        "Performance evidence/source changed before output: " + filename,
      );
  const file = await open(output, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify({ ...result, inputs }, null, 2));
  } finally {
    await file.close();
  }
  return result;
}

if (import.meta.main) {
  const [input, output, extra] = Bun.argv.slice(2);
  if (!input || !output || extra !== undefined)
    throw Error(
      "Usage: bun qualify-replay-performance.mjs <private-request.json> <new-private-result.json>",
    );
  const result = await runReplayPerformanceQualification(input, output);
  console.log(
    JSON.stringify({
      output: resolve(output),
      status: result.status,
      rates: result.rates,
    }),
  );
}
