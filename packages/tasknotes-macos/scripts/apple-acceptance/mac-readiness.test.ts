import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { macAcceptancePlan } from "../occurrence-acceptance/run-macos.ts";
import { readMacEvidence, requireMacReadinessCapture } from "./mac-evidence.ts";
import {
  configureMacAcceptanceTestRun,
  recordMacAcceptanceOutcome,
} from "./mac-journey.ts";

const directories: string[] = [];
async function directory() {
  const root = await mkdtemp(
    path.join(tmpdir(), "facet-capture-readiness-control-"),
  );
  directories.push(root);
  return root;
}
afterEach(async () => {
  for (const root of directories.splice(0)) await rm(root, { recursive: true });
});

test("readiness has its own exact selector, result, status and single-launch contract", async () => {
  expect(macAcceptancePlan()).toEqual(macAcceptancePlan("recurrence"));
  expect(macAcceptancePlan("recurrence")).toMatchObject({
    suite: "OccurrenceVaultUITests",
    test: "testGenerationRepairUndoAndColdRelaunch",
    kind: "native-occurrence-macos",
    result: "Occurrence.xcresult",
    launches: 3,
    successStatus: "passed",
  });
  const readiness = macAcceptancePlan("capture-readiness");
  expect(readiness).toEqual({
    suite: "CaptureReadinessUITests",
    test: "testOwnedSyntheticWindowCapture",
    selector:
      "TaskNotesAcceptanceUITests/CaptureReadinessUITests/testOwnedSyntheticWindowCapture",
    kind: "native-capture-readiness-macos",
    result: "CaptureReadiness.xcresult",
    launches: 1,
    successStatus: "capture-ready",
  });
  const root = await directory();
  await recordMacAcceptanceOutcome(
    { kind: readiness.kind },
    [],
    root,
    "unused",
    readiness.successStatus,
  );
  expect(await Bun.file(path.join(root, "run.json")).json()).toEqual({
    kind: readiness.kind,
    status: "capture-ready",
  });
  await expect(
    recordMacAcceptanceOutcome(
      { kind: readiness.kind },
      [new Error("missing capture")],
      root,
      "failed",
      readiness.successStatus,
    ),
  ).rejects.toThrow("failed");
  expect(await Bun.file(path.join(root, "run.json")).json()).toMatchObject({
    status: "failed",
  });
});

const originalRunner =
  "__TESTROOT__/Debug/TaskNotesAcceptanceUITests-Runner.app";
const originalBundle =
  "__TESTHOST__/Contents/PlugIns/TaskNotesAcceptanceUITests.xctest";
const originalProducts = [
  "__TESTROOT__/Debug/FacetAcceptance.app",
  originalRunner,
  `${originalRunner}/Contents/PlugIns/TaskNotesAcceptanceUITests.xctest`,
];
const stableRunner = "/owned/stable/TaskNotesAcceptanceUITests-Runner.app";
test("stable Runner changes only its three exact known paths", async () => {
  const writes: string[][] = [];
  await configureMacAcceptanceTestRun(
    "owned.xctestrun",
    {},
    async (argv) => {
      if (argv[1] === "-extract")
        return argv[2]?.endsWith("DependentProductPaths")
          ? JSON.stringify(originalProducts)
          : argv[2]?.endsWith("TestBundlePath")
            ? originalBundle
            : originalRunner;
      writes.push(argv);
      return "";
    },
    stableRunner,
  );
  expect(writes.slice(0, 3).map((argv) => argv.slice(2, 5))).toEqual([
    ["TaskNotesAcceptanceUITests.TestHostPath", "-string", stableRunner],
    [
      "TaskNotesAcceptanceUITests.DependentProductPaths.1",
      "-string",
      stableRunner,
    ],
    [
      "TaskNotesAcceptanceUITests.DependentProductPaths.2",
      "-string",
      `${stableRunner}/Contents/PlugIns/TaskNotesAcceptanceUITests.xctest`,
    ],
  ]);
  expect(writes).toHaveLength(5);
});
test.each(["products", "host", "bundle", "path"])(
  "unexpected stable Runner %s prevents all writes",
  async (bad) => {
    const writes: string[][] = [];
    await expect(
      configureMacAcceptanceTestRun(
        "owned.xctestrun",
        {},
        async (argv) => {
          if (argv[1] !== "-extract") {
            writes.push(argv);
            return "";
          }
          return argv[2]?.endsWith("DependentProductPaths")
            ? JSON.stringify(
                bad === "products"
                  ? [...originalProducts, "foreign.app"]
                  : originalProducts,
              )
            : argv[2]?.endsWith("TestBundlePath")
              ? bad === "bundle"
                ? "foreign.xctest"
                : originalBundle
              : bad === "host"
                ? "foreign.app"
                : originalRunner;
        },
        bad === "path"
          ? "/owned/../stable/TaskNotesAcceptanceUITests-Runner.app"
          : stableRunner,
      ),
    ).rejects.toThrow();
    expect(writes).toEqual([]);
  },
);

test("readiness requires the named PNG and completed capture diagnostics from its exact test", async () => {
  const root = await directory();
  const screenshots = path.join(root, "screenshots");
  const name = "Capture readiness — owned synthetic workspace";
  const attachment = (label: string, file: string) => ({
    suggestedHumanReadableName: label,
    exportedFileName: file,
  });
  const traceAttachment = attachment(
    `Capture state diagnostics — ${name}_0_UUID.json`,
    "trace.json",
  );
  const attachments = [
    attachment(`${name}_0_UUID.png`, "owned.png"),
    traceAttachment,
  ];
  const writeManifest = (
    values = attachments,
    testIdentifier = "CaptureReadinessUITests/testOwnedSyntheticWindowCapture()",
  ) =>
    Bun.write(
      path.join(screenshots, "manifest.json"),
      JSON.stringify([{ testIdentifier, attachments: values }]),
    );
  await writeManifest();
  await Bun.write(
    path.join(screenshots, "owned.png"),
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  const writeTrace = (phase: string) =>
    Bun.write(
      path.join(screenshots, "trace.json"),
      JSON.stringify({
        schemaVersion: 1,
        omittedSamples: 0,
        samples: [
          "beforeActivation",
          "afterActivation",
          "beforeCapture",
          "afterCapture",
          "afterDecode",
          phase,
        ].map((phase) => ({ phase })),
      }),
    );
  await writeTrace("completed");
  await expect(requireMacReadinessCapture(root)).resolves.toBeUndefined();
  await writeTrace("failed");
  await expect(requireMacReadinessCapture(root)).rejects.toThrow();
  await writeTrace("completed");
  await writeManifest(attachments.slice(0, 1));
  await expect(requireMacReadinessCapture(root)).rejects.toThrow();
  await writeManifest(
    attachments,
    "OccurrenceVaultUITests/testGenerationRepairUndoAndColdRelaunch()",
  );
  await expect(requireMacReadinessCapture(root)).rejects.toThrow();
  await writeManifest([
    attachment(`${name}_0_UUID.png`, "../foreign.png"),
    traceAttachment,
  ]);
  await expect(requireMacReadinessCapture(root)).rejects.toThrow();
});

test("transport admits only the explicitly named readiness result root", () => {
  const file = {
    path: "CaptureReadiness.xcresult/Info.plist",
    bytes: 1,
    sha256: "a".repeat(64),
  };
  const manifest = { schemaVersion: 1, runID: "owned", files: [file] };
  expect(readMacEvidence(manifest, "owned")).toEqual([file]);
  expect(() =>
    readMacEvidence(
      {
        ...manifest,
        files: [{ ...file, path: "OtherCapture.xcresult/Info.plist" }],
      },
      "owned",
    ),
  ).toThrow();
});
