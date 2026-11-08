import { describe, expect, test } from "vitest";
import { ManifestSchema, requiredCases } from "./model";
import {
  control,
  nativeClientConfiguration,
  ownedProfile,
  replicaDirectory,
  runNativeTest,
} from "./native";
import {
  assertSelectedNativeClients,
  selectedInitialConfigurationJourneys,
} from "./native-evidence";
import { lifecycleBegin, lifecycleFinish } from "./recovery";
import { outboxSnapshot } from "./outbox";

const runID = "1d09432f-45c4-4392-a320-3ac199963410";
const state = {
  container: "/owned/macos",
  descriptor: "/owned/macos/acceptance.json",
  stateDirectory: "/owned/macos/state",
};
function manifest(macOnly: boolean) {
  const common = {
    runID,
    createdAt: "2026-10-11T12:00:00.000Z",
    round: 1,
    failures: [],
    completedRounds: [],
    operations: {},
    stage: "bound",
    allowedRemoteVaultID: "owned-vault",
    reference: {},
    pluginFixtureSHA256: "a".repeat(64),
    cases: Object.fromEntries(requiredCases.map((name) => [name, "pending"])),
  };
  return ManifestSchema.parse(
    macOnly
      ? {
          ...common,
          schemaVersion: 2,
          scope: "macos",
          simulator: null,
          clients: { macos: state },
        }
      : {
          ...common,
          schemaVersion: 1,
          simulator: { id: runID, name: `Facet Live Sync ${runID}` },
          clients: { ios: state, macos: state },
        },
  );
}

describe("native acceptance scope", () => {
  test("Mac XCTest selects the desktop destination without a simulator", () => {
    const selected = nativeClientConfiguration(manifest(true), "macos");
    expect(selected.target).toBe("TaskNotesAcceptanceUITests");
    expect(selected.destination).toBe("platform=macOS");
    expect(selected.simulatorEnvironment).toEqual({});
    expect(selected.state).toEqual(state);
    const legacy = nativeClientConfiguration(manifest(false), "ios");
    expect(legacy.target).toBe("TasksForObsidianUITests");
    expect(legacy.destination).toBe(`platform=iOS Simulator,id=${runID}`);
    expect(legacy.simulatorEnvironment).toEqual({ FACET_E2E_SIMULATOR: runID });
  });

  test("initial usability and convergence require exactly the declared clients", () => {
    const mac = manifest(true);
    expect(selectedInitialConfigurationJourneys(mac)).toEqual([
      { client: "macos", label: "initial-configuration-macos" },
    ]);
    expect(
      selectedInitialConfigurationJourneys(manifest(false)).map(
        ({ client }) => client,
      ),
    ).toEqual(["ios", "macos"]);
    expect(() =>
      assertSelectedNativeClients(mac, [{ client: "macos" }]),
    ).not.toThrow();
    for (const entries of [
      [],
      [{ client: "ios" }],
      [{ client: "macos" }, { client: "ios" }],
      [{ client: "macos" }, { client: "macos" }],
    ])
      expect(() => assertSelectedNativeClients(mac, entries)).toThrow(
        "exactly the selected",
      );
    expect(() =>
      assertSelectedNativeClients(manifest(false), [{ client: "macos" }]),
    ).toThrow("exactly the selected");
  });

  test("unselected iOS entry points reject before filesystem or native effects", async () => {
    const value = manifest(true);
    expect(() => nativeClientConfiguration(value, "ios")).toThrow(
      "not selected",
    );
    expect(() => replicaDirectory(value, "ios", runID)).toThrow("not selected");
    await expect(
      runNativeTest(
        value,
        "ios",
        "LiveSyncVaultUITests/testInitialDownloadUsesTaskNotesConfiguration",
        { label: "unselected" },
      ),
    ).rejects.toThrow("not selected");
    await expect(control(value, "ios", "interrupt", runID)).rejects.toThrow(
      "not selected",
    );
    await expect(ownedProfile(value, "ios")).rejects.toThrow("not selected");
    await expect(outboxSnapshot(value, "ios", runID)).rejects.toThrow(
      "not selected",
    );
    await expect(lifecycleBegin(value, "ios")).rejects.toThrow("not selected");
    await expect(lifecycleFinish(value, "ios")).rejects.toThrow("not selected");
  });
});
