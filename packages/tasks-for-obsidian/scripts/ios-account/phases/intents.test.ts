import { expect, test } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
  symlink,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  recordHostIntent,
  retainNativeIntents,
  submissionIntent,
} from "./intents";

const identity = {
  runID: "12345678-1234-4234-9234-123456789abc",
  sessionID: "22345678-1234-4234-9234-123456789abc",
  deviceID: "32345678-1234-4234-9234-123456789abc",
};
const command = {
  schemaVersion: 1 as const,
  ...identity,
  requestID: "42345678-1234-4234-9234-123456789abc",
  kind: "submit" as const,
};
async function fixture() {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "facet-phase-intent-")),
  );
  const evidence = path.join(root, "evidence"),
    socket = path.join(root, "tmp/FacetAccountInput", identity.sessionID),
    native = path.join(root, "tmp/FacetAccountIntents", identity.sessionID);
  await mkdir(evidence, { mode: 0o700 });
  await mkdir(socket, { recursive: true, mode: 0o700 });
  return { root, evidence, socket, native };
}
test("durable host intent is exclusive and cannot be overwritten by a repeat", async () => {
  const f = await fixture();
  try {
    const intent = submissionIntent("auth-only", command);
    expect(intent).toBeDefined();
    if (intent === undefined) throw new Error("missing fixture intent");
    await recordHostIntent(f.evidence, intent);
    const file = path.join(f.evidence, "intents/host/credentials.json"),
      before = await readFile(file);
    await expect(recordHostIntent(f.evidence, intent)).rejects.toThrow();
    expect(await readFile(file)).toEqual(before);
    expect(Object.keys(JSON.parse(before.toString("utf8")))).not.toContain(
      "password",
    );
  } finally {
    await rm(f.root, { recursive: true });
  }
});
test("cross-phase submission is rejected by the original neutral intent decoder", () => {
  expect(() => submissionIntent("connect-only", command)).toThrow();
  expect(() =>
    submissionIntent("auth-only", {
      ...command,
      kind: "connect",
      remoteVaultID: "owned-vault",
    }),
  ).toThrow();
});
test("native intent retains original bytes and binds the existing host authority", async () => {
  const f = await fixture();
  try {
    const intent = submissionIntent("auth-only", command);
    if (intent === undefined) throw new Error("fixture");
    await recordHostIntent(f.evidence, intent);
    await mkdir(f.native, { recursive: true, mode: 0o700 });
    const original = Buffer.from(JSON.stringify(intent, null, 2));
    await writeFile(path.join(f.native, "credentials.json"), original, {
      mode: 0o600,
    });
    const result = await retainNativeIntents(f.socket, f.evidence, identity);
    expect(result.actions).toEqual(["credentials"]);
    expect(result.missingNative).toEqual([]);
    expect(
      await readFile(path.join(f.evidence, "intents/native/credentials.json")),
    ).toEqual(original);
  } finally {
    await rm(f.root, { recursive: true });
  }
});
test("host intent without native acknowledgment stays explicitly missing", async () => {
  const f = await fixture();
  try {
    const intent = submissionIntent("auth-only", command);
    if (intent === undefined) throw new Error("fixture");
    await recordHostIntent(f.evidence, intent);
    const retained = await retainNativeIntents(f.socket, f.evidence, identity);
    expect(retained.missingNative).toEqual(["credentials.json"]);
  } finally {
    await rm(f.root, { recursive: true });
  }
});
test("unbound or symlinked native intents cannot become submission authority", async () => {
  const f = await fixture();
  try {
    await mkdir(f.native, { recursive: true, mode: 0o700 });
    const publicFile = path.join(f.root, "public.json");
    await writeFile(publicFile, "{}", { mode: 0o600 });
    await symlink(publicFile, path.join(f.native, "credentials.json"));
    await expect(
      retainNativeIntents(f.socket, f.evidence, identity),
    ).rejects.toThrow();
  } finally {
    await rm(f.root, { recursive: true });
  }
});
