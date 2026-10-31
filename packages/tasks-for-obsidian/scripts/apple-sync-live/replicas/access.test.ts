import { beforeEach, describe, expect, test, vi } from "vitest";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  activeClients,
  ManifestSchema,
  requiredCases,
  runDirectory,
  runs,
  StatusSchema,
  validate,
} from "../model";
import { save } from "../platform";
import { assertRoundComplete } from "../ledger";
import { augmentFromOfficial } from "../journeys";
import { outboxSnapshot } from "../outbox";
import { parseExecutionArguments } from "../prepare";
import {
  changeReference,
  localVault,
  readVaultFile,
  renameReference,
  verifyVaultEndpoint,
} from "./access";

const transport = vi.hoisted(() => ({
  guestSnapshot: vi.fn(),
  guestReadFiles: vi.fn(),
  guestReferenceApply: vi.fn(),
  guestOutbox: vi.fn(),
  requestGuest: vi.fn(),
}));
vi.mock("../transport/client", async (original) => ({
  ...(await original<object>()),
  ...transport,
}));

const runID = "1d09432f-45c4-4392-a320-3ac199963410";
const artifactBuildID = "2d09432f-45c4-4392-a320-3ac199963410";
const profileID = "3d09432f-45c4-4392-a320-3ac199963410";
function manifest() {
  const value = ManifestSchema.parse({
    schemaVersion: 3,
    scope: "macos",
    runID,
    createdAt: "2026-10-27T12:00:00.000Z",
    round: 1,
    failures: [],
    completedRounds: [],
    operations: {},
    simulator: null,
    stage: "initial-verified",
    allowedRemoteVaultID: "owned-vault",
    reference: {},
    pluginFixtureSHA256: "a".repeat(64),
    cases: Object.fromEntries(
      requiredCases.map((name) => [
        name,
        name === "three-consecutive-runs" ? "pending" : "pass",
      ]),
    ),
    execution: {
      kind: "tart-guest",
      vm: "owned-vm",
      guestBundlePath: `/Volumes/My Shared Files/exports/${artifactBuildID}/live-guest.js`,
      guestBundleSHA256: "b".repeat(64),
      guestConfigSHA256: "c".repeat(64),
      guestRunID: runID,
      artifactBuildID,
      artifactSHA256: "d".repeat(64),
      payloadSHA256: "e".repeat(64),
    },
    clients: {
      macos: {
        container: "/guest-only/never-host",
        descriptor: "/guest-only/descriptor",
        stateDirectory: "/guest-only/state",
      },
    },
  });
  if (value.schemaVersion !== 3)
    throw new Error("Expected the guest fixture variant");
  return value;
}

beforeEach(() => {
  vi.clearAllMocks();
});

test("typed status round trips preserve every required neutral-schema field", () => {
  const status = {
    schemaVersion: 1,
    runID,
    capturedAt: "2026-10-27T12:00:00.000Z",
    accountBusy: false,
    accountStage: "credentials",
    profiles: [],
    accountExchange: {
      requestKind: "sign_in",
      stage: "post",
      statusCode: 200,
      failureClassification: null,
      boundaryCode: null,
      requestID: profileID,
      capturedAt: "2026-10-27T12:00:00.000Z",
    },
  };
  validate("status", status);
  const typed = StatusSchema.parse(status);
  expect(typed).toEqual(status);
  expect(() => validate("status", typed)).not.toThrow();
  expect(() =>
    validate("status", { ...status, token: "forbidden-field" }),
  ).toThrow();
});

describe("actual guest replica matrix boundaries", () => {
  test("guest identity, selected scope and full consecutive matrix remain required", () => {
    const value = manifest();
    expect(activeClients(value)).toEqual(["macos"]);
    expect(() => localVault(value, "official")).toThrow(
      "cannot be dereferenced",
    );
    expect(() => localVault(value, { client: "macos", profileID })).toThrow(
      "cannot be dereferenced",
    );
    expect(() =>
      ManifestSchema.parse({
        ...value,
        execution: { ...value.execution, guestRunID: profileID },
      }),
    ).toThrow();
    expect(() =>
      ManifestSchema.parse({
        ...value,
        clients: { ...value.clients, ios: value.clients?.macos },
      }),
    ).toThrow();
    expect(() => assertRoundComplete(value)).not.toThrow();
    for (const name of requiredCases.filter(
      (entry) => entry !== "three-consecutive-runs",
    ))
      expect(() =>
        assertRoundComplete({
          ...value,
          cases: { ...value.cases, [name]: "pending" },
        }),
      ).toThrow();
    expect(() => assertRoundComplete({ ...value, round: 3 })).toThrow(
      "consecutive",
    );
  });

  test("verification reads exact endpoint inventory and rejects extra or changed files", async () => {
    const value = manifest();
    const expected = { "Reference.md": { size: 3, sha256: "a".repeat(64) } };
    transport.guestSnapshot.mockResolvedValue(expected);
    await verifyVaultEndpoint(value, { client: "macos", profileID }, expected);
    expect(transport.guestSnapshot).toHaveBeenCalledWith(value, { profileID });
    transport.guestSnapshot.mockResolvedValue({
      ...expected,
      "Unexpected.md": expected["Reference.md"],
    });
    await expect(
      verifyVaultEndpoint(value, "official", expected),
    ).rejects.toThrow("unexpected");
    transport.guestSnapshot.mockResolvedValue({
      "Reference.md": { size: 3, sha256: "b".repeat(64) },
    });
    await expect(
      verifyVaultEndpoint(value, "official", expected),
    ).rejects.toThrow();
  });

  test("file bytes and outbox come from the actual endpoint, never a host mirror", async () => {
    const value = manifest();
    const bytes = Uint8Array.from([0, 255, 10]);
    transport.guestReadFiles.mockResolvedValue({
      "Attachments/sentinel.bin": bytes,
    });
    expect(
      await readVaultFile(value, "official", "Attachments/sentinel.bin"),
    ).toEqual(Buffer.from(bytes));
    transport.guestOutbox.mockResolvedValue({
      count: 2,
      sha256: "f".repeat(64),
    });
    expect(await outboxSnapshot(value, "macos", profileID)).toEqual({
      count: 2,
      sha256: "f".repeat(64),
    });
    expect(transport.guestOutbox).toHaveBeenCalledWith(value, profileID);
    await expect(
      readVaultFile(value, "official", "../outside"),
    ).rejects.toThrow();
    expect(transport.guestReadFiles).toHaveBeenCalledTimes(1);
  });

  test("reference operations carry exact prior byte fences and distinguish create", async () => {
    const value = manifest();
    value.reference["Tasks/Known.md"] = { size: 3, sha256: "a".repeat(64) };
    const bytes = Uint8Array.from([1, 2, 3]);
    await changeReference(value, "Tasks/Known.md", bytes);
    await changeReference(value, "Tasks/New.md", bytes);
    await renameReference(value, "Tasks/Known.md", "Tasks/Renamed.md");
    expect(
      transport.guestReferenceApply.mock.calls.map((call) => call[1]),
    ).toEqual([
      {
        kind: "write",
        path: "Tasks/Known.md",
        bytes,
        expectedSHA256: "a".repeat(64),
      },
      { kind: "write", path: "Tasks/New.md", bytes, expectedSHA256: null },
      {
        kind: "rename",
        path: "Tasks/Known.md",
        destination: "Tasks/Renamed.md",
        expectedSHA256: "a".repeat(64),
      },
    ]);
    await expect(
      renameReference(value, "Tasks/Unknown.md", "Tasks/Other.md"),
    ).rejects.toThrow("known source");
  });

  test("native additions are discovered and parsed in the official endpoint", async () => {
    const value = manifest();
    const bytes = new TextEncoder().encode(
      "---\ntitle: Native sentinel\nstatus: open\npriority: high\n---\nBody\n",
    );
    transport.guestSnapshot.mockResolvedValue({
      "Tasks/Added.md": { size: bytes.length, sha256: "a".repeat(64) },
    });
    transport.guestReadFiles.mockResolvedValue({ "Tasks/Added.md": bytes });
    expect(
      Object.keys(await augmentFromOfficial(value, ["Native sentinel"], true)),
    ).toEqual(["Tasks/Added.md"]);
    await expect(
      augmentFromOfficial(value, ["Another task"], true),
    ).rejects.toThrow("Unexpected");
  });

  test("automated and explicit manual preparation cannot silently cross modes", () => {
    expect(() => parseExecutionArguments([])).toThrow("Choose exactly");
    expect(
      parseExecutionArguments(["--host-ui", "--clients", "macos"]),
    ).toMatchObject({ scope: "macos", vm: undefined });
    expect(() => parseExecutionArguments(["--vm", "owned-vm"])).toThrow();
    expect(() =>
      parseExecutionArguments(["--host-ui", "--vm", "owned-vm"]),
    ).toThrow();
    expect(
      parseExecutionArguments([
        "--vm",
        "owned-vm",
        "--official-export",
        artifactBuildID,
        "--official-sha256",
        "a".repeat(64),
      ]),
    ).toMatchObject({
      scope: "apple",
      vm: "owned-vm",
      officialApp: { exportID: artifactBuildID, archiveSHA256: "a".repeat(64) },
    });
  });

  test("a rejected guest checkpoint still durably retains the host failure gate", async () => {
    const identity = crypto.randomUUID();
    const value = manifest();
    value.runID = identity;
    value.execution.guestRunID = identity;
    value.stage = "failed";
    value.failures.push({
      round: 1,
      operation: "native",
      capturedAt: value.createdAt,
    });
    const directory = runDirectory(identity);
    await mkdir(runs, { recursive: true, mode: 0o700 });
    await mkdir(directory, { recursive: false, mode: 0o700 });
    transport.requestGuest.mockRejectedValueOnce(
      new Error("Guest unavailable"),
    );
    try {
      await expect(save(value)).rejects.toThrow("Guest unavailable");
      const retained = ManifestSchema.parse(
        JSON.parse(
          await readFile(path.join(directory, "manifest.json"), "utf8"),
        ),
      );
      expect(retained.stage).toBe("failed");
      expect(retained.failures).toEqual(value.failures);
      expect(transport.requestGuest).toHaveBeenCalledWith(
        value,
        expect.objectContaining({
          kind: "checkpoint",
          checkpoint: expect.objectContaining({
            failuresCount: 1,
            stage: "failed",
          }),
        }),
      );
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});
