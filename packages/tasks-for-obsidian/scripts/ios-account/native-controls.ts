import assert from "node:assert/strict";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  rmdir,
} from "node:fs/promises";
import { createConnection } from "node:net";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { boundaryCheck } from "./contract";
import { inspectInputOwner, inputBinary } from "./app-input-artifacts";
import { childEnvironment } from "tasknotes-macos/scripts/mac-account-contract.ts";

// Explicit Mac-only controls: no simulator, application or credential operation.
assert.equal(process.platform, "darwin");
const root = await realpath(
  await mkdtemp(path.join(os.tmpdir(), "facet-ios-bridge-controls-")),
);
const executable = path.join(root, "bridge");
const diagnostic = z.strictObject({
  kind: z.literal("rejected"),
  phase: z.enum([
    "bootstrap",
    "stdio",
    "directory",
    "socket",
    "peer",
    "authorization",
    "pump",
  ]),
  reason: z.enum(["boundary", "peer", "deadline", "frame", "io"]),
  errno: z.number().int(),
});
const compile = Bun.spawn(
  [
    "/usr/bin/xcrun",
    "swiftc",
    "-swift-version",
    "6",
    path.join(import.meta.dir, "native/bridge.swift"),
    "-o",
    executable,
  ],
  { env: childEnvironment(Bun.env), stdout: "pipe", stderr: "pipe" },
);
const [compileOut, compileErr, compileCode] = await Promise.all([
  new Response(compile.stdout).text(),
  new Response(compile.stderr).text(),
  compile.exited,
]);
assert.equal(compileCode, 0);
assert.equal(compileOut, "");
assert.equal(compileErr, "");
await chmod(executable, 0o700);
const owner = path.join(root, "owner");
const ownerCompile = Bun.spawn(
  [
    "/usr/bin/xcrun",
    "swiftc",
    path.resolve(
      import.meta.dir,
      "../../../tasknotes-macos/scripts/apple-acceptance/mac-process-owner.swift",
    ),
    "-o",
    owner,
  ],
  { env: childEnvironment(Bun.env), stdout: "pipe", stderr: "pipe" },
);
const [ownerOut, ownerErr, ownerCode] = await Promise.all([
  new Response(ownerCompile.stdout).text(),
  new Response(ownerCompile.stderr).text(),
  ownerCompile.exited,
]);
assert.equal(ownerCode, 0);
assert.equal(ownerOut, "");
assert.equal(ownerErr, "");
await chmod(owner, 0o700);
let passed = 0;
try {
  const artifacts = {
    bridge: await inputBinary(executable),
    owner: await inputBinary(owner),
  };
  const target = { executable: await realpath(process.execPath) };
  const identity = await inspectInputOwner(
    root,
    artifacts,
    process.pid,
    target,
  );
  assert.equal(identity.uid, process.getuid?.());
  passed += 1;
  for (const changed of [
    { ...identity, uid: identity.uid + 1 },
    {
      ...identity,
      startMicroseconds: (identity.startMicroseconds + 1) % 1_000_000,
    },
  ]) {
    await assert.rejects(
      inspectInputOwner(root, artifacts, process.pid, {
        ...target,
        expected: changed,
      }),
    );
    passed += 1;
  }
  await assert.rejects(
    inspectInputOwner(
      root,
      { ...artifacts, owner: "0".repeat(64) },
      process.pid,
      target,
    ),
  );
  passed += 1;
  for (const operation of [
    "startup-cancel",
    "bad-authorization",
    "oversize-frame",
    "private-parent-eof",
    "terminal-ack-parent-eof",
  ] as const) {
    const directory = "/private/tmp/facet-account-" + crypto.randomUUID();
    await mkdir(directory, { mode: 0o700 });
    const child = Bun.spawn([executable, path.join(directory, "input.sock")], {
      env: childEnvironment(Bun.env),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const reader = child.stdout.getReader();
    let buffered = "";
    async function line() {
      while (!buffered.includes("\n")) {
        const next = await reader.read();
        if (next.done) {
          const code = await child.exited;
          const stderr = await new Response(child.stderr).text();
          const reason = diagnostic.parse(JSON.parse(stderr));
          throw new Error(
            `Native bridge control ${operation} exited ${code}: ${reason.phase}/${reason.reason}/${reason.errno}`,
          );
        }
        buffered += new TextDecoder().decode(next.value);
        assert.ok(buffered.length <= 8192);
      }
      const end = buffered.indexOf("\n"),
        value: unknown = JSON.parse(buffered.slice(0, end));
      buffered = buffered.slice(end + 1);
      return value;
    }
    let peer: ReturnType<typeof createConnection> | undefined;
    const deadline = setTimeout(() => {
      child.kill("SIGTERM");
    }, 5000);
    try {
      const listening = await line();
      boundaryCheck("bridge-packet", listening);
      assert.deepEqual(listening, {
        kind: "listening",
        pid: child.pid,
        uid: process.getuid?.(),
      });
      if (operation === "startup-cancel") await child.stdin.end();
      else {
        peer = createConnection({ path: path.join(directory, "input.sock") });
        peer.on("error", () => {
          peer?.destroy();
        });
        const peerPacket = await line();
        boundaryCheck("bridge-packet", peerPacket);
        assert.deepEqual(peerPacket, {
          kind: "peer",
          pid: process.pid,
          uid: process.getuid?.(),
        });
        await child.stdin.write(operation === "bad-authorization" ? "B" : "A");
        await child.stdin.flush();
        await controlInput(operation, peer, child.stdin, line);
      }
      const code = await child.exited,
        stderr = await new Response(child.stderr).text();
      assert.equal(
        code,
        operation === "bad-authorization" || operation === "oversize-frame"
          ? 3
          : 0,
      );
      if (operation === "bad-authorization" || operation === "oversize-frame") {
        const packet: unknown = JSON.parse(stderr);
        boundaryCheck("bridge-packet", packet);
        const rejected = diagnostic.parse(packet);
        assert.equal(
          rejected.reason,
          operation === "bad-authorization" ? "peer" : "frame",
        );
        assert.equal(
          rejected.phase,
          operation === "bad-authorization" ? "authorization" : "pump",
        );
      } else assert.equal(stderr, "");
      assert.equal(
        await Bun.file(path.join(directory, "input.sock")).exists(),
        false,
      );
      passed += 1;
    } finally {
      clearTimeout(deadline);
      peer?.destroy();
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await child.exited;
      }
      await reader.cancel();
      await rmdir(directory);
    }
  }
  const metadata = await lstat(executable);
  assert.equal(metadata.uid, process.getuid?.());
  console.log(
    JSON.stringify({
      nativeBridgeControlsPassed: passed,
      helperSHA256: new Bun.CryptoHasher("sha256")
        .update(await readFile(executable))
        .digest("hex"),
      applicationLaunches: 0,
      credentialReads: 0,
    }),
  );
} finally {
  await rm(root, { recursive: true });
}

async function controlInput(
  operation: string,
  peer: ReturnType<typeof createConnection>,
  input: Bun.FileSink,
  line: () => Promise<unknown>,
) {
  if (operation === "oversize-frame") peer.write("x".repeat(8193) + "\n");
  if (operation === "private-parent-eof") await input.end();
  if (operation === "terminal-ack-parent-eof") {
    peer.write('{"public":"terminal-ack"}\n');
    assert.deepEqual(await line(), { public: "terminal-ack" });
    await input.end();
  }
}
