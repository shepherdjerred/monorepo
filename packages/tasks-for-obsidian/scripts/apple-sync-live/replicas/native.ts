import path from "node:path";
import {
  clientState,
  runDirectory,
  type Client,
  type Manifest,
} from "../model";
import { assertExactNativeJourney } from "../native-evidence";
import { guestSnapshot, requestGuest } from "../transport/client";
import {
  NativeExtraSchema,
  NativeLabelSchema,
  NativeSelectorSchema,
} from "../transport/execution/contract";
import { retainGuestEvidence } from "./evidence";

export type NativeTestOptions = {
  label: string;
  extra?: Record<string, string>;
  timeoutMS?: number;
};

export function selectedClientConfiguration(
  manifest: Manifest,
  client: Client,
) {
  const state = clientState(manifest, client);
  if (manifest.allowedRemoteVaultID === null)
    throw new Error("Native live journeys require a bound, authenticated run");
  if (client === "ios" && manifest.simulator === null)
    throw new Error("The iOS acceptance simulator is missing");
  return {
    state,
    target:
      client === "ios"
        ? "TasksForObsidianUITests"
        : "TaskNotesAcceptanceUITests",
    destination:
      client === "ios" && manifest.simulator !== null
        ? `platform=iOS Simulator,id=${manifest.simulator.id}`
        : "platform=macOS",
    simulatorEnvironment:
      client === "ios" && manifest.simulator !== null
        ? { FACET_E2E_SIMULATOR: manifest.simulator.id }
        : {},
  };
}

export async function runGuestNativeTest(
  manifest: Extract<Manifest, { schemaVersion: 3 }>,
  selector: string,
  options: NativeTestOptions,
) {
  try {
    await executeGuestNativeTest(manifest, selector, options);
  } catch (error) {
    const failures = [error];
    try {
      const prefix = `journeys/round-${String(manifest.round)}/${NativeLabelSchema.parse(options.label)}/`;
      const files = Object.keys(
        await guestSnapshot(manifest, "evidence"),
      ).filter((relative) => relative.startsWith(prefix));
      if (files.length > 0) await retainGuestEvidence(manifest, files);
    } catch (error_) {
      failures.push(error_);
    }
    throw new AggregateError(
      failures,
      "Guest native journey failed; retained evidence is not passing proof",
      { cause: error },
    );
  }
}

async function executeGuestNativeTest(
  manifest: Extract<Manifest, { schemaVersion: 3 }>,
  selector: string,
  options: NativeTestOptions,
) {
  const label = NativeLabelSchema.parse(options.label);
  const selected = NativeSelectorSchema.parse(selector);
  const result = await requestGuest(manifest, {
    kind: "native",
    selector: selected,
    label,
    extra: NativeExtraSchema.parse(options.extra ?? {}),
    timeoutMS: options.timeoutMS ?? 600_000,
  });
  if (result.kind !== "native") throw new Error("Wrong guest native response");
  const expected = `journeys/round-${String(manifest.round)}/${label}`;
  if (
    result.selector !== selected ||
    result.label !== label ||
    result.evidenceDirectory !== expected
  )
    throw new Error("Guest native evidence belongs to another selected test");
  await retainGuestEvidence(manifest, result.files);
  const directory = path.join(runDirectory(manifest.runID), expected);
  assertExactNativeJourney(
    await Bun.file(path.join(directory, "summary.json")).json(),
    await Bun.file(path.join(directory, "tests.json")).json(),
    "TaskNotesAcceptanceUITests",
    selected,
  );
}
