import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { acceptanceProvenance, assertRoundComplete } from "./ledger";
import {
  activeClients,
  clientState,
  ManifestSchema,
  requiredCases,
  fixtures,
  digest,
  verifyReplica,
} from "./model";
import {
  parsePreparationArguments,
  prepareNativeClients,
  seed,
} from "./prepare";
import { descriptor, launch } from "./platform";

const runID = "1d09432f-45c4-4392-a320-3ac199963410";
const state = {
  container: "/owned",
  descriptor: "/owned/acceptance.json",
  stateDirectory: "/owned/state",
};
function fields() {
  return {
    runID,
    createdAt: "2026-10-11T12:00:00.000Z",
    round: 1,
    failures: [],
    completedRounds: [],
    operations: {},
    simulator: null,
    stage: "preparing",
    allowedRemoteVaultID: null,
    reference: {},
    pluginFixtureSHA256: "a".repeat(64),
    cases: Object.fromEntries(requiredCases.map((name) => [name, "pending"])),
  };
}
function macManifest() {
  return ManifestSchema.parse({
    ...fields(),
    schemaVersion: 2,
    scope: "macos",
    clients: { macos: state },
  });
}

describe("declared live acceptance scope", () => {
  test("legacy manifests retain both required clients and reject scope reinterpretation", () => {
    const value = {
      ...fields(),
      schemaVersion: 1,
      clients: { ios: state, macos: state },
    };
    expect(activeClients(ManifestSchema.parse(value))).toEqual([
      "ios",
      "macos",
    ]);
    expect(() =>
      ManifestSchema.parse({ ...value, clients: { macos: state } }),
    ).toThrow();
    expect(() => ManifestSchema.parse({ ...value, scope: "macos" })).toThrow();
  });

  test("Mac manifests reject missing selected client, extra iOS state and simulators", () => {
    const value = macManifest();
    expect(activeClients(value)).toEqual(["macos"]);
    expect(clientState(value, "macos")).toEqual(state);
    expect(() => ManifestSchema.parse({ ...value, clients: {} })).toThrow();
    expect(() =>
      ManifestSchema.parse({ ...value, clients: { macos: state, ios: state } }),
    ).toThrow();
    expect(() =>
      ManifestSchema.parse({
        ...value,
        simulator: { id: runID, name: "unselected" },
      }),
    ).toThrow();
    expect(() => clientState(value, "ios")).toThrow("not selected");
    expect(() => descriptor(value, "ios", null)).toThrow("not selected");
    expect(() => clientState({ ...value, clients: null }, "macos")).toThrow(
      "not prepared",
    );
  });

  test("unselected launch fails before invoking native tools", async () => {
    await expect(launch(macManifest(), true, "ios")).rejects.toThrow(
      "not selected",
    );
  });

  test("CLI preserves the default and accepts only the explicit supported selector", () => {
    expect(parsePreparationArguments([])).toBe("apple");
    expect(parsePreparationArguments(["--clients", "macos"])).toBe("macos");
    for (const args of [
      ["macos"],
      ["--clients", "ios"],
      ["--clients", "macos", "extra"],
    ])
      expect(() => parsePreparationArguments(args)).toThrow();
  });
});

describe("native preparation scope", () => {
  test("Mac preparation actually issues only shared and Mac build commands", async () => {
    const value = macManifest();
    value.clients = null;
    const execute = vi.fn(async () => "");
    const persist = vi.fn(() => Promise.resolve());
    const result = await prepareNativeClients(value, execute, persist);
    const commands = execute.mock.calls.map((args) => args[0]);
    expect(commands).toEqual([
      ["cargo", "xtask", "check-xcframework"],
      ["xcodegen", "generate"],
      expect.arrayContaining([
        "xcodebuild",
        "build-for-testing",
        "TaskNotesAcceptance",
        "platform=macOS",
      ]),
    ]);
    expect(commands.flat().join(" ")).not.toMatch(
      /simctl|ios:native|TasksForObsidian|iOS Simulator/u,
    );
    expect(result.iosApp).toBeUndefined();
    expect(result.macApp).toContain(
      "macos/Build/Products/Debug/FacetAcceptance.app",
    );
    expect(value.simulator).toBeNull();
    expect(Object.keys(value.clients ?? {})).toEqual(["macos"]);
    expect(persist).not.toHaveBeenCalled();
  });

  test("default preparation still builds both clients and owns its new simulator", async () => {
    const value = ManifestSchema.parse({
      ...fields(),
      schemaVersion: 1,
      clients: null,
    });
    const calls: string[][] = [];
    const execute = vi.fn(async (args: string[]) => {
      calls.push(args);
      if (args[2] === "create") return runID;
      return args[2] === "get_app_container" ? "/owned-ios" : "";
    });
    const persist = vi.fn(() => Promise.resolve());
    const result = await prepareNativeClients(value, execute, persist);
    expect(calls).toContainEqual(["bun", "run", "ios:native:generate"]);
    expect(calls.filter((args) => args[0] === "xcodebuild")).toHaveLength(2);
    expect(calls).toContainEqual([
      "xcrun",
      "simctl",
      "create",
      `Facet Live Sync ${runID}`,
      "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro",
    ]);
    expect(calls).toContainEqual([
      "xcrun",
      "simctl",
      "install",
      runID,
      result.iosApp,
    ]);
    expect(activeClients(value)).toEqual(["ios", "macos"]);
    expect(clientState(value, "ios").container).toBe("/owned-ios");
    expect(persist).toHaveBeenCalledOnce();
  });

  test("explicit Mac runner signing stays scoped and invalid identities fail before tools", async () => {
    const calls: string[][] = [];
    const execute = vi.fn(async (args: string[]) => {
      calls.push(args);
      return "";
    });
    const identity = "a".repeat(40);
    await prepareNativeClients(
      macManifest(),
      execute,
      vi.fn(() => Promise.resolve()),
      identity,
    );
    const build = calls.find((args) => args[0] === "xcodebuild");
    expect(build).toContain(`TASKNOTES_UITEST_IDENTITY=${identity}`);
    expect(
      build?.some((argument) => argument.startsWith("CODE_SIGN_IDENTITY=")),
    ).toBe(false);
    execute.mockClear();
    await expect(
      prepareNativeClients(
        macManifest(),
        execute,
        vi.fn(() => Promise.resolve()),
        "invalid",
      ),
    ).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });

  test("synthetic seed suppresses official onboarding without changing task or attachment contents", async () => {
    const temporary = await realpath(
      await mkdtemp(path.join(os.tmpdir(), "facet-live-seed-test-")),
    );
    const directory = path.join(temporary, "reference-vault");
    try {
      const result = await seed(directory);
      const settings = await Bun.file(
        path.join(directory, ".obsidian/plugins/tasknotes/data.json"),
      ).json();
      expect(settings.starterNoteCreated).toBe(true);
      expect(settings.autoCreateDefaultBasesFiles).toBe(false);
      const pinned = await Bun.file(
        path.join(fixtures, "vault/tasknotes-4.13.8-statuses.json"),
      ).json();
      expect(settings.customStatuses).toEqual(pinned.statuses);
      expect(await readFile(path.join(directory, "Reference.md"))).toEqual(
        await readFile(path.join(fixtures, "e2e/local-vault/Reference.md")),
      );
      expect(
        await Bun.file(path.join(directory, "Tasks/Existing.md")).text(),
      ).toBe(
        "---\ntitle: E2E existing task\nstatus: open\npriority: normal\ntags: [task]\ndateCreated: 2026-10-01T00:00:00Z\ndateModified: 2026-10-01T00:00:00Z\ncustom_property: preserved\n---\nLive Sync preservation sentinel.\n",
      );
      expect(result.reference["Attachments/empty.bin"]).toEqual({
        size: 0,
        sha256: digest(new Uint8Array(0)),
      });
      const binary = Uint8Array.from(
        { length: 2 * 1024 * 1024 + 1024 },
        (_, index) => index % 251,
      );
      expect(
        await readFile(path.join(directory, "Attachments/multi-piece.bin")),
      ).toEqual(Buffer.from(binary));
      await expect(
        verifyReplica(directory, result.reference),
      ).resolves.toBeUndefined();
    } finally {
      await rm(temporary, { recursive: true });
    }
  });

  test("provenance cannot cross scopes or silently introduce iOS artifacts", () => {
    const base = {
      runID,
      sourceHead: "head",
      sourceFiles: {},
      macApp: {},
      pluginSettingsFixture: {},
      expectedTaskNotesVersion: "4.13.8",
      officialObsidianVersion: null,
    };
    const mac = { ...base, schemaVersion: 2, scope: "macos" };
    const apple = { ...base, schemaVersion: 1, iosApp: {} };
    const legacy = ManifestSchema.parse({
      ...fields(),
      schemaVersion: 1,
      clients: null,
    });
    expect(() => acceptanceProvenance(macManifest(), mac)).not.toThrow();
    expect(() => acceptanceProvenance(legacy, apple)).not.toThrow();
    expect(() => acceptanceProvenance(macManifest(), apple)).toThrow();
    expect(() => acceptanceProvenance(legacy, mac)).toThrow();
    expect(() =>
      acceptanceProvenance(macManifest(), { ...mac, iosApp: {} }),
    ).toThrow();
  });

  test("Mac scope still requires every case and consecutive rounds", () => {
    const value = macManifest();
    for (const name of requiredCases)
      if (name !== "three-consecutive-runs") value.cases[name] = "pass";
    expect(() => assertRoundComplete(value)).not.toThrow();
    value.cases["authentication-failures"] = "pending";
    expect(() => assertRoundComplete(value)).toThrow("Every acceptance case");
    value.cases["authentication-failures"] = "pass";
    value.round = 3;
    expect(() => assertRoundComplete(value)).toThrow("consecutive");
  });
});
