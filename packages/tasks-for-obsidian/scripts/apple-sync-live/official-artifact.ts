import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { z } from "zod";
import {
  PendingCheckpoint,
  digest,
  atomicJSON,
  runDirectory,
  type Manifest,
} from "./model";
import { requestGuest } from "./transport/client";

const officialCLI = "/Applications/Obsidian.app/Contents/MacOS/obsidian-cli";

/** The public CLI's current remote version is index zero. Keep its date as
 * an opaque version fence: it is a local-time display, not a UTC timestamp. */
export function officialHistoryHead(output: string) {
  const first = output.split("\n")[0];
  const match =
    /^0: (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \(([1-9]\d*) bytes\)(?: \[[^\]\r\n]*\])?$/u.exec(
      first ?? "",
    );
  if (match === null)
    throw new Error("Official remote history has no current file version");
  return {
    version: 0,
    timestamp: z.string().parse(match[1]),
    // History reports stored bytes, which differ from decoded plaintext.
    // Retain the value without inferring an encryption overhead formula.
    storedSize: z.number().int().positive().parse(Number(match[2])),
    historyHeadSHA256: digest(first ?? ""),
  };
}

export function assertOfficialRemoteVersion(
  output: Uint8Array,
  relative: string,
  head: ReturnType<typeof officialHistoryHead>,
  expected: Uint8Array,
) {
  const header = new TextEncoder().encode(
    `${relative} (version ${String(head.version)}, ${head.timestamp})\n---\n`,
  );
  if (!header.every((byte, index) => output[index] === byte))
    throw new Error(
      "Official remote version header differs from the selected history",
    );
  const content = output.subarray(header.length);
  if (
    content.length !== expected.length ||
    digest(content) !== digest(expected)
  )
    throw new Error(
      "Official remote version does not match the divergent reference bytes",
    );
  return { size: content.length, sha256: digest(content) };
}

async function officialRead(argv: string[], vault: string, timeoutMS: number) {
  // Never stream account diagnostics or file contents to stdout/logs. Unlike
  // developer-tool output, remote content must preserve every whitespace byte.
  const environment: Record<string, string> = {};
  for (const key of ["PATH", "HOME", "TMPDIR", "USER", "LOGNAME", "LANG"])
    if (Bun.env[key] !== undefined) environment[key] = Bun.env[key];
  const child = Bun.spawn([officialCLI, ...argv], {
    cwd: vault,
    env: environment,
    stdout: "pipe",
    stderr: "pipe",
    detached: true,
  });
  const timeout = { expired: false };
  const timer = setTimeout(() => {
    timeout.expired = true;
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }, timeoutMS);
  try {
    const [bytes, stderr, exit] = await Promise.all([
      new Response(child.stdout).bytes(),
      new Response(child.stderr).bytes(),
      child.exited,
    ]);
    if (
      exit !== 0 ||
      timeout.expired ||
      bytes.length > 2 * 1024 * 1024 ||
      stderr.length > 2 * 1024 * 1024
    )
      throw new Error(
        "Official Obsidian CLI read failed or exceeded its bound",
      );
    return bytes;
  } finally {
    clearTimeout(timer);
  }
}

export async function waitForOfficialPublication(
  manifest: Manifest,
  relative: string,
  expected: Uint8Array,
  caseID: string,
) {
  return manifest.schemaVersion === 3
    ? waitForGuestPublication(manifest, relative, expected, caseID)
    : waitForLocalPublication(manifest, relative, expected, caseID);
}

async function waitForGuestPublication(
  manifest: Extract<Manifest, { schemaVersion: 3 }>,
  relative: string,
  expected: Uint8Array,
  caseID: string,
) {
  if (manifest.scope !== "macos" || manifest.allowedRemoteVaultID === null)
    throw new Error(
      "Official remote publication proof is only for a bound Mac-only run",
    );
  const requestedAt = new Date().toISOString();
  const result = await requestGuest(manifest, {
    kind: "official-publication",
    relative,
    expectedBytes: Buffer.from(expected).toString("base64"),
    caseID,
  });
  if (
    result.kind !== "official-publication" ||
    result.caseID !== caseID ||
    result.relative !== relative ||
    result.fingerprint.sha256 !== digest(expected) ||
    result.fingerprint.size !== expected.length
  )
    throw new Error(
      "Guest official publication differs from the exact conflict bytes",
    );
  await atomicJSON(
    path.join(
      runDirectory(manifest.runID),
      `conflict-macos-publication-${caseID}.json`,
    ),
    {
      schemaVersion: 1,
      runID: manifest.runID,
      round: manifest.round,
      caseID,
      source: "official-obsidian-cli-remote-version",
      requestedAt,
      observedAt: new Date().toISOString(),
      relative,
      ...result.head,
      ...result.fingerprint,
    },
  );
}

async function waitForLocalPublication(
  manifest: Manifest,
  relative: string,
  expected: Uint8Array,
  caseID: string,
) {
  if (manifest.schemaVersion !== 2 || manifest.allowedRemoteVaultID === null)
    throw new Error(
      "Official remote publication proof is only for a bound Mac-only run",
    );
  const vault = path.join(runDirectory(manifest.runID), "reference-vault");
  const deadline = Date.now() + 120_000;
  const read = (argv: string[]) =>
    officialRead(
      argv,
      vault,
      Math.max(1, Math.min(10_000, deadline - Date.now())),
    );
  while (Date.now() < deadline) {
    // CWD targeting is the supported public vault selector. Fail closed if
    // Obsidian selected another open vault instead of this exact reference.
    if (
      new TextDecoder().decode(await read(["vault", "info=path"])).trim() !==
      vault
    )
      throw new Error(
        "Official CLI is not targeting the owned reference vault",
      );
    try {
      const requestedAt = new Date().toISOString();
      const head = officialHistoryHead(
        new TextDecoder().decode(
          await read(["sync:history", `path=${relative}`]),
        ),
      );
      const fingerprint = assertOfficialRemoteVersion(
        await read([
          "sync:read",
          `path=${relative}`,
          `version=${String(head.version)}`,
        ]),
        relative,
        head,
        expected,
      );
      const after = officialHistoryHead(
        new TextDecoder().decode(
          await read(["sync:history", `path=${relative}`]),
        ),
      );
      if (JSON.stringify(after) !== JSON.stringify(head))
        throw new Error(
          "Official remote history changed during publication proof",
        );
      if (
        new TextDecoder().decode(await read(["vault", "info=path"])).trim() !==
        vault
      )
        throw new Error("Official CLI lost its owned reference vault");
      if (Date.now() >= deadline)
        throw new Error("Official publication proof exceeded its deadline");
      await atomicJSON(
        path.join(
          runDirectory(manifest.runID),
          `conflict-macos-publication-${caseID}.json`,
        ),
        {
          schemaVersion: 1,
          runID: manifest.runID,
          round: manifest.round,
          caseID,
          source: "official-obsidian-cli-remote-version",
          requestedAt,
          observedAt: new Date().toISOString(),
          relative,
          ...head,
          ...fingerprint,
        },
      );
      return;
    } catch {
      // The new divergent revision may still be uploading. A local synced
      // label is never substituted for a remote-version content readback.
    }
    await Bun.sleep(500);
  }
  throw new Error(
    "Official divergent remote publication was not proven before its deadline",
  );
}

export function validateOfficialScreenshot(bytes: Uint8Array) {
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  if (
    bytes.length < 45 ||
    bytes.length > 20 * 1024 * 1024 ||
    !png.every((byte, index) => bytes[index] === byte)
  )
    throw new Error("Official UI evidence must be a bounded PNG screenshot");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const compressed: Uint8Array[] = [];
  let dimensions: { width: number; height: number } | undefined;
  let finished = false;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset);
    const end = offset + length + 12;
    if (end > bytes.length) throw new Error("Truncated official UI screenshot");
    const kind = new TextDecoder().decode(
      bytes.subarray(offset + 4, offset + 8),
    );
    if (
      Bun.hash.crc32(bytes.subarray(offset + 4, end - 4)) !==
      view.getUint32(end - 4)
    )
      throw new Error("Corrupt official UI screenshot");
    if (offset === 8) {
      dimensions = headerDimensions(kind, length, view, offset);
    }
    if (kind === "IDAT") compressed.push(bytes.subarray(offset + 8, end - 4));
    if (kind === "IEND") {
      finished = length === 0 && end === bytes.length;
      break;
    }
    offset = end;
  }
  const validated = requireDimensions(dimensions, finished, compressed.length);
  const image = inflateSync(Buffer.concat(compressed), {
    maxOutputLength: 128 * 1024 * 1024,
  });
  if (image.length < validated.height)
    throw new Error("Invalid PNG image payload");
  return validated;
}

function headerDimensions(
  kind: string,
  length: number,
  view: DataView,
  offset: number,
) {
  if (kind !== "IHDR" || length !== 13)
    throw new Error("Invalid PNG image header");
  return {
    width: view.getUint32(offset + 8),
    height: view.getUint32(offset + 12),
  };
}

function requireDimensions(
  dimensions: { width: number; height: number } | undefined,
  finished: boolean,
  chunks: number,
) {
  if (
    !finished ||
    chunks === 0 ||
    dimensions === undefined ||
    dimensions.width < 320 ||
    dimensions.height < 320 ||
    dimensions.width * dimensions.height > 25_000_000
  )
    throw new Error(
      "Official UI evidence requires a complete readable screenshot",
    );
  return dimensions;
}

export async function readOfficialArtifact(directory: string, step: string) {
  if (!["create", "edit", "complete", "uncomplete"].includes(step))
    throw new Error("Invalid official UI step");
  const filename = path.join(directory, `${step}.png`);
  if (!(await Bun.file(filename).exists()))
    throw new PendingCheckpoint(
      `Save a synthetic-only official TaskNotes screenshot at ${filename}; exclude credentials and unrelated vaults.`,
    );
  if (
    (await realpath(directory)) !== directory ||
    (await realpath(filename)) !== filename
  )
    throw new Error(
      "Official UI evidence must remain in its owned artifact directory",
    );
  const stat = await lstat(filename);
  if (!stat.isFile() || stat.size > 20 * 1024 * 1024)
    throw new Error("Invalid official UI artifact file");
  const bytes = await readFile(filename);
  return {
    filename,
    sha256: digest(bytes),
    size: bytes.length,
    ...validateOfficialScreenshot(bytes),
  };
}
