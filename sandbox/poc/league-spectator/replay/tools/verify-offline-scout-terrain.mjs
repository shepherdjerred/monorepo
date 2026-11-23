import { mkdir, open } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const usage =
  "Usage: bun verify-offline-scout-terrain.mjs <proof-directory> -- <serve-native-terrain.mjs worker-mode arguments>";
const startupTimeoutMs = 90_000;
const workerCheckTimeoutMs = 120_000;
const browserCheckTimeoutMs = 240_000;

const [directory, separator, ...workerArgs] = process.argv.slice(2);
if (!directory || separator !== "--" || workerArgs.length === 0)
  throw Error(usage);
const { tokens } = parseArgs({
  args: workerArgs,
  options: { "worker-decompressor": { type: "string" } },
  allowPositionals: true,
  strict: false,
  tokens: true,
});
const workerFlags = tokens.filter(
  (token) => token.kind === "option" && token.name === "worker-decompressor",
);
if (
  workerFlags.length !== 1 ||
  !workerFlags[0].value ||
  workerFlags[0].value.startsWith("--")
)
  throw Error(usage + "\nSupply exactly one --worker-decompressor path.");
const workerFlag = workerFlags[0];
const baselineArgs = workerArgs.slice();
baselineArgs.splice(workerFlag.index, workerFlag.inlineValue ? 1 : 2);
const node = Bun.which("node");
if (!node)
  throw Error("Node is required to execute the offline Worker verifier.");

const output = resolve(directory);
await mkdir(dirname(output), { recursive: true });
try {
  // Reserve the evidence directory atomically before writing any proof files.
  await mkdir(output);
} catch (cause) {
  if (cause.code === "EEXIST")
    throw Error(`Choose a new proof directory: ${output}`, { cause });
  throw cause;
}
const script = (name) => fileURLToPath(new URL(name, import.meta.url));
const children = new Set();
const interrupted = new AbortController();
const interrupt = () => interrupted.abort(Error("Offline proof interrupted."));
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);

async function waitFor(result, timeoutMs, label) {
  const signal = AbortSignal.any([
    interrupted.signal,
    AbortSignal.timeout(timeoutMs),
  ]);
  return await new Promise((resolveResult, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const abort = () =>
      reject(
        interrupted.signal.aborted
          ? interrupted.signal.reason
          : Error(`${label} timed out after ${timeoutMs / 1000} seconds.`),
      );
    signal.addEventListener("abort", abort, { once: true });
    result.then(resolveResult, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

async function start(label, args, readOrigin = false) {
  const stdoutPath = join(output, `${label}.stdout.log`);
  const stderrPath = join(output, `${label}.stderr.log`);
  const stdout = await open(stdoutPath, "w");
  let stderr;
  try {
    stderr = await open(stderrPath, "w");
    const proc = Bun.spawn(args, {
      stdout: readOrigin ? "pipe" : stdout.fd,
      stderr: stderr.fd,
      windowsHide: true,
    });
    const origin = Promise.withResolvers();
    const capture = readOrigin
      ? captureServerOutput(proc.stdout, stdout, origin.resolve)
      : Promise.resolve();
    const settled = Promise.all([proc.exited, capture]).then(([code]) => code);
    const finished = Promise.allSettled([settled, proc.exited]).then(
      async () => {
        await Promise.all([stdout.close(), stderr.close()]);
      },
    );
    const child = { proc, finished };
    children.add(child);
    const ready = readOrigin
      ? Promise.race([
          origin.promise,
          settled.then((code) => {
            throw Error(`${label} exited before publishing its URL (${code}).`);
          }),
        ])
      : settled;
    return { ready, stdoutPath, stderrPath };
  } catch (cause) {
    await Promise.all([stdout.close(), stderr?.close()]);
    throw cause;
  }
}

async function captureServerOutput(stream, log, onOrigin) {
  const decoder = new TextDecoder();
  let beforeUrl = "";
  let found = false;
  for await (const bytes of stream) {
    await log.write(bytes);
    if (found) continue;
    beforeUrl += decoder.decode(bytes, { stream: true });
    const lines = beforeUrl.split(/\r?\n/);
    beforeUrl = lines.pop();
    const line = lines.find((value) => value.startsWith("http"));
    if (line) {
      const url = new URL(line);
      if (
        url.protocol !== "http:" ||
        url.hostname !== "127.0.0.1" ||
        !url.port ||
        url.href !== url.origin + "/"
      )
        throw Error("Replay server published an invalid loopback origin.");
      found = true;
      onOrigin(url.href);
    }
  }
}

async function run(label, args, timeoutMs, readOrigin = false) {
  interrupted.signal.throwIfAborted();
  const { ready, stdoutPath, stderrPath } = await start(
    label,
    args,
    readOrigin,
  );
  console.log(`${label} → ${stdoutPath}`);
  try {
    const result = await waitFor(ready, timeoutMs, label);
    if (!readOrigin && result !== 0)
      throw Error(`${label} exited with code ${result}.`);
    return result;
  } catch (cause) {
    throw Error(`${cause.message}\nLogs: ${stdoutPath}\n      ${stderrPath}`, {
      cause,
    });
  }
}

try {
  const serve = script("serve-native-terrain.mjs");
  const origins = await Promise.allSettled([
    run(
      "worker-server",
      [process.execPath, serve, ...workerArgs],
      startupTimeoutMs,
      true,
    ),
    run(
      "baseline-server",
      [process.execPath, serve, ...baselineArgs],
      startupTimeoutMs,
      true,
    ),
  ]);
  const rejected = origins.find((result) => result.status === "rejected");
  if (rejected) throw rejected.reason;
  const [worker, baseline] = origins.map((result) => result.value);
  if (worker === baseline)
    throw Error("Replay servers must use distinct ports.");
  console.log(`Worker ${worker} and baseline ${baseline}`);

  await run(
    "worker-check",
    [
      node,
      script("verify-offline-terrain-motion-worker.mjs"),
      worker,
      baseline,
    ],
    workerCheckTimeoutMs,
  );
  await run(
    "browser-check",
    [
      process.execPath,
      script("verify-browser-scout-terrain.mjs"),
      worker,
      join(output, "browser"),
      baseline,
    ],
    browserCheckTimeoutMs,
  );
  console.log(`Offline Scout terrain proof passed. Evidence in ${output}`);
} finally {
  for (const { proc } of children) {
    if (proc.exitCode === null && proc.signalCode === null) proc.kill();
  }
  await Promise.all(Array.from(children, ({ finished }) => finished));
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
}
