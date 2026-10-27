import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { createGuestDispatcher } from "./guest.ts";
import {
  runID,
  binding,
  guestDirectories,
  dispatcherOptions,
  emptyStatus,
} from "./fixtures.test-support.ts";
import { contentSHA } from "./fields.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true });
});
async function fixture() {
  const { root, paths } = await guestDirectories(
    roots,
    "facet-guest-dispatch-",
  );
  const options = dispatcherOptions(paths);
  return { root, paths, options };
}
function request(operation: unknown) {
  return {
    schemaVersion: 1,
    binding,
    requestID: crypto.randomUUID(),
    issuedAt: new Date().toISOString(),
    operation,
  };
}

test("valid snapshot is measured from the owned guest root with exact request correlation", async () => {
  const { options, paths } = await fixture();
  await writeFile(
    path.join(paths.referenceDirectory, "Reference.md"),
    "synthetic",
  );
  const input = request({ kind: "snapshot", target: "official" });
  const reply = await createGuestDispatcher(options)(input);
  expect(reply).toMatchObject({
    requestID: input.requestID,
    binding,
    result: {
      kind: "snapshot",
      files: { "Reference.md": { size: 9, sha256: contentSHA("synthetic") } },
    },
  });
});

test("wrong binding, stale requests and unknown operation fields perform no mutation", async () => {
  const { options, paths } = await fixture();
  const original = request({
    kind: "referenceApply",
    change: {
      kind: "delete",
      path: "Tasks/Missing.md",
      expectedSHA256: "a".repeat(64),
    },
  });
  const dispatch = createGuestDispatcher(options);
  expect(
    await dispatch({ ...original, binding: { ...binding, round: 2 } }),
  ).toMatchObject({ outcome: "rejected", reason: "binding" });
  expect(
    await dispatch({ ...original, issuedAt: new Date(0).toISOString() }),
  ).toMatchObject({ outcome: "rejected", reason: "binding" });
  expect(
    await dispatch({
      ...original,
      operation: { kind: "snapshot", target: "official", command: "sh" },
    }),
  ).toMatchObject({ outcome: "rejected", reason: "request" });
  expect(await readdir(paths.evidenceDirectory)).toEqual([]);
});

test("private account failures and mutation journals never expose input or a password digest", async () => {
  const { options, paths } = await fixture(),
    secret = "private-account-sentinel";
  options.execute = async () => {
    throw new Error(secret);
  };
  const input = request({
    kind: "account",
    action: {
      mode: "fill_credentials",
      email: "test@example.invalid",
      password: secret,
      lifetime: { startSeconds: 1, startMicroseconds: 1, launchDate: 1 },
    },
  });
  const reply = await createGuestDispatcher(options)(input);
  expect(JSON.stringify(reply)).not.toContain(secret);
  expect(reply).toMatchObject({ outcome: "rejected", reason: "operation" });
  const journal = await readFile(
    path.join(
      paths.evidenceDirectory,
      "transport-requests",
      `${input.requestID}.json`,
    ),
    "utf8",
  );
  for (const forbidden of [
    secret,
    contentSHA(secret),
    "test@example.invalid",
    "password",
    "action",
  ])
    expect(journal).not.toContain(forbidden);
  expect(await createGuestDispatcher(options)(input)).toMatchObject({
    outcome: "rejected",
    reason: "duplicate",
  });
  expect(await readdir(paths.evidenceDirectory)).not.toContain(
    "transport-lease",
  );
});

test("preflight refusal cannot execute a hook or create a request journal", async () => {
  const { options, paths } = await fixture();
  options.preflight = async () => {
    throw new Error("not an owned guest");
  };
  let called = false;
  options.execute = async () => {
    called = true;
    return { kind: "retire", observedExit: true, signalSubmitted: false };
  };
  expect(
    await createGuestDispatcher(options)(request({ kind: "retire" })),
  ).toMatchObject({ outcome: "rejected", reason: "binding" });
  expect(called).toBe(false);
  expect(await readdir(paths.evidenceDirectory)).toEqual([]);
});

test("interruption reads only the actual bounded run-owned control receipt", async () => {
  const { options, paths } = await fixture();
  await mkdir(path.join(paths.stateDirectory, "control"));
  const file = path.join(paths.stateDirectory, "control/interruption.json");
  const interruption = {
    schemaVersion: 1,
    runID,
    profileIDs: [crypto.randomUUID()],
  };
  await writeFile(file, JSON.stringify(interruption));
  expect(
    await createGuestDispatcher(options)(request({ kind: "interruption" })),
  ).toMatchObject({ result: { kind: "interruption", interruption } });
  await writeFile(
    file,
    JSON.stringify({ ...interruption, runID: crypto.randomUUID() }),
  );
  expect(
    await createGuestDispatcher(options)(request({ kind: "interruption" })),
  ).toMatchObject({ outcome: "rejected" });
});

test("status preserves the complete validated producer contract including accountExchange", async () => {
  const { options, paths } = await fixture();
  await mkdir(path.join(paths.stateDirectory, "control"));
  const status = emptyStatus();
  await writeFile(
    path.join(paths.stateDirectory, "control/status.json"),
    JSON.stringify(status),
  );
  const reply = await createGuestDispatcher(options)(
    request({ kind: "status" }),
  );
  expect(reply).toMatchObject({ result: { kind: "status", status } });
  if (!("result" in reply) || reply.result.kind !== "status")
    throw new Error("Status was rejected");
  const statusValue = reply.result.status;
  const { validate } = await import("../model.ts");
  expect(() => validate("status", statusValue)).not.toThrow();
});
