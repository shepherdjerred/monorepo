import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { root } from "../../model";
import {
  verificationProtocol,
  verificationFrame,
} from "./official-verification-protocol";

assert.equal(
  process.platform,
  "darwin",
  "Native controls require the macOS SDK",
);
const directory = await realpath(
  await mkdtemp(path.join(os.tmpdir(), "facet-official-mfa-codec-")),
);
const source = path.join(
  root,
  "packages/tasknotes-macos/scripts/native/official-account",
);
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
try {
  const binary = path.join(directory, "codec");
  const compiled = spawnSync(
    "/usr/bin/xcrun",
    [
      "swiftc",
      path.join(source, "OfficialOwner.swift"),
      path.join(source, "OfficialAccountContainer.swift"),
      path.join(source, "OfficialVerification.swift"),
      path.join(source, "controls/main.swift"),
      "-o",
      binary,
    ],
    { encoding: "utf8", timeout: 60_000, maxBuffer: 1_048_576 },
  );
  assert.equal(
    compiled.status,
    0,
    "Original native verification codec must compile",
  );
  assert.equal(compiled.stderr, "");
  const helpers = path.join(directory, "live-helpers");
  await mkdir(helpers, { mode: 0o700 });
  const protocolFile = path.join(
    helpers,
    "official-verification.protocol.json",
  );
  await copyFile(
    path.join(source, "official-verification.protocol.json"),
    protocolFile,
    1,
  );
  const config = path.join(directory, "live-config.json");
  const bytes = Buffer.from(
    JSON.stringify({
      helpers: {
        "official-verification.protocol.json": sha(
          await readFile(protocolFile),
        ),
      },
    }),
  );
  await writeFile(config, bytes, { flag: "wx", mode: 0o600 });
  let checked = 0;
  const run = (
    kind: string,
    value: Record<string, unknown>,
    valid: boolean,
  ) => {
    let typescript = true;
    try {
      verificationFrame(kind, value);
    } catch {
      typescript = false;
    }
    assert.equal(typescript, valid, "TypeScript protocol outcome");
    const native = spawnSync(binary, [kind, config, sha(bytes)], {
      input: JSON.stringify(value) + "\n",
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 8192,
    });
    assert.equal(
      native.status,
      valid ? 0 : 3,
      "Original Swift protocol outcome",
    );
    assert.equal(native.stderr, "");
    assert.deepEqual(JSON.parse(native.stdout), { valid });
    checked++;
  };
  const uuid = "12345678-1234-4234-9234-123456789abc";
  for (const [kind, names] of Object.entries(verificationProtocol.frames)) {
    const value: Record<string, unknown> = {};
    for (const name of names) {
      const field = verificationProtocol.fields[name];
      assert.ok(field !== undefined);
      if (field.enum !== undefined) value[name] = field.enum[0];
      else if (field.type === "boolean") value[name] = true;
      else if (field.type !== "string") value[name] = field.minimum ?? 1;
      else if (name === "code") value[name] = "246802";
      else if (name.endsWith("ID")) value[name] = uuid;
      else if (name.endsWith("SHA256")) value[name] = "a".repeat(64);
      else value[name] = "/owned/public";
    }
    if (names.includes("kind")) value["kind"] = kind;
    if (verificationProtocol.frameModes[kind] !== undefined)
      value["mode"] = verificationProtocol.frameModes[kind];
    run(kind, value, true);
    run(kind, { ...value, unexpected: "public-only-sentinel" }, false);
    const [first] = names;
    assert.ok(first !== undefined);
    run(
      kind,
      Object.fromEntries(
        Object.entries(value).filter(([name]) => name !== first),
      ),
      false,
    );
    if (kind === "code")
      for (const code of ["12345", "1234567", "12345\n", "abcdef"])
        run(kind, { ...value, code }, false);
    if (kind === "ready") run(kind, { ...value, codeFieldSecure: true }, false);
  }
  const containerBinary = path.join(directory, "container-controls");
  const containerCompile = spawnSync(
    "/usr/bin/xcrun",
    [
      "swiftc",
      path.join(source, "OfficialOwner.swift"),
      path.join(source, "OfficialAccountContainer.swift"),
      path.join(source, "OfficialVerification.swift"),
      path.join(source, "controls/container/main.swift"),
      "-o",
      containerBinary,
    ],
    { encoding: "utf8", timeout: 60_000, maxBuffer: 1_048_576 },
  );
  assert.equal(
    containerCompile.status,
    0,
    "Original native account selector must compile",
  );
  assert.equal(containerCompile.stderr, "");
  const containerResult = spawnSync(containerBinary, [], {
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 8192,
  });
  assert.equal(
    containerResult.status,
    0,
    "Original native account selector controls must pass",
  );
  assert.equal(containerResult.stderr, "");
  const containerReceipt: unknown = JSON.parse(containerResult.stdout);
  assert.deepEqual(containerReceipt, {
    originalSwiftContainerSelector: true,
    checked: 13,
    passed: true,
    uiActions: 0,
  });
  console.log(
    JSON.stringify({
      originalSwiftCodec: true,
      sharedDefinition: true,
      checked,
      originalSwiftContainerControls: 13,
      passed: true,
      uiActions: 0,
      credentialReads: 0,
    }),
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
