import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  StaticProvider,
  type StaticFlagValue,
} from "@shepherdjerred/feature-flags/providers/static.ts";
import {
  initializeDynamicConfig,
  refreshDynamicConfig,
  shutdownDynamicConfig,
  type DynamicConfigSeed,
} from "#src/config/dynamic.ts";
import { resetConfigurationForTests } from "#src/configuration.ts";
import { DEFAULT_EXPLORE_QUOTA_LIMITS } from "#src/configuration/explore-quota.ts";

const io = vi.hoisted(() => ({ hardDisabled: vi.fn(() => false) }));
// The Scout Client hard-disable is the coupling this gate replaced. Driving it
// directly proves the gate no longer reads it.
vi.mock("#src/configuration/flags.ts", async (original) => ({
  ...(await original()),
  isFeatureHardDisabled: io.hardDisabled,
}));

const { evidenceRecoveryEnabled } = await import("./recovery-gate.ts");

const SEED: DynamicConfigSeed = {
  exploreGuildAllowlist: [],
  exploreQuotaLimits: DEFAULT_EXPLORE_QUOTA_LIMITS,
  llmHourlyTokenBudget: 2_000_000,
  llmDailyTokenBudget: 20_000_000,
  temporalCallGraphTracing: false,
};

const FLAG = "scout-evidence-recovery-enabled";

type Answers = Readonly<Record<string, StaticFlagValue>>;
type BooleanArgs = Parameters<StaticProvider["resolveBooleanEvaluation"]>;
type StringArgs = Parameters<StaticProvider["resolveStringEvaluation"]>;
type NumberArgs = Parameters<StaticProvider["resolveNumberEvaluation"]>;
type ObjectArgs = Parameters<StaticProvider["resolveObjectEvaluation"]>;

/** A provider whose answers a test can change between refreshes. */
class SwitchableProvider {
  readonly runsOn = "server";
  readonly metadata = { name: "SwitchableProvider" } as const;
  private current: StaticProvider;

  constructor(answers: Answers) {
    this.current = new StaticProvider(answers);
  }

  answer(answers: Answers): void {
    this.current = new StaticProvider(answers);
  }

  resolveBooleanEvaluation(...args: BooleanArgs) {
    return this.current.resolveBooleanEvaluation(...args);
  }

  resolveStringEvaluation(...args: StringArgs) {
    return this.current.resolveStringEvaluation(...args);
  }

  resolveNumberEvaluation(...args: NumberArgs) {
    return this.current.resolveNumberEvaluation(...args);
  }

  resolveObjectEvaluation<T extends ObjectArgs[1]>(
    flagKey: string,
    defaultValue: T,
    context: ObjectArgs[2],
  ) {
    return this.current.resolveObjectEvaluation(flagKey, defaultValue, context);
  }
}

const originalEnvironment = Bun.env["ENVIRONMENT"];

function deployAs(environment: "dev" | "beta" | "prod"): void {
  Bun.env["ENVIRONMENT"] = environment;
  resetConfigurationForTests();
}

beforeEach(() => {
  io.hardDisabled.mockReset();
  io.hardDisabled.mockReturnValue(false);
});

afterEach(async () => {
  await shutdownDynamicConfig();
  if (originalEnvironment === undefined) delete Bun.env["ENVIRONMENT"];
  else Bun.env["ENVIRONMENT"] = originalEnvironment;
  resetConfigurationForTests();
});

describe("evidence-recovery gate", () => {
  test.each([
    ["prod", false],
    ["beta", true],
    ["dev", true],
  ] as const)(
    "%s keeps its current contract before dynamic config is initialized",
    (environment, expected) => {
      deployAs(environment);
      expect(evidenceRecoveryEnabled()).toBe(expected);
    },
  );

  test.each([
    ["prod", false],
    ["beta", true],
  ] as const)(
    "%s resolves its managed default at boot when no flag answers",
    async (environment, expected) => {
      deployAs(environment);
      await initializeDynamicConfig({
        environment: {
          FEATURE_FLAGS_MODE: "disabled",
          FLIPT_ENVIRONMENT: environment,
        },
        seed: SEED,
        startPolling: false,
      });
      expect(evidenceRecoveryEnabled()).toBe(expected);
    },
  );

  test.each([
    ["prod", false],
    ["beta", true],
  ] as const)(
    "%s does not move when the scout_client_ingestion hard-disable changes",
    async (environment, expected) => {
      deployAs(environment);
      await initializeDynamicConfig({
        environment: {
          FEATURE_FLAGS_MODE: "disabled",
          FLIPT_ENVIRONMENT: environment,
        },
        seed: SEED,
        startPolling: false,
        provider: new StaticProvider({
          scout_client_ingestion: !expected,
          scout_client_result_recovery: !expected,
        }),
      });
      for (const hardDisabled of [true, false, true]) {
        io.hardDisabled.mockReturnValue(hardDisabled);
        expect(evidenceRecoveryEnabled()).toBe(expected);
      }
      expect(io.hardDisabled).not.toHaveBeenCalled();
    },
  );

  test("its own flag answers, independent of the client flag", async () => {
    deployAs("beta");
    await initializeDynamicConfig({
      environment: {
        FEATURE_FLAGS_MODE: "disabled",
        FLIPT_ENVIRONMENT: "beta",
      },
      seed: SEED,
      startPolling: false,
      provider: new StaticProvider({
        [FLAG]: false,
        scout_client_ingestion: true,
      }),
    });
    expect(evidenceRecoveryEnabled()).toBe(false);
  });

  test("is pinned at boot: a later refresh does not change it", async () => {
    deployAs("beta");
    const provider = new SwitchableProvider({ [FLAG]: true });
    await initializeDynamicConfig({
      environment: {
        FEATURE_FLAGS_MODE: "disabled",
        FLIPT_ENVIRONMENT: "beta",
      },
      seed: SEED,
      startPolling: false,
      provider,
    });
    expect(evidenceRecoveryEnabled()).toBe(true);

    provider.answer({ [FLAG]: false });
    await refreshDynamicConfig();
    expect(evidenceRecoveryEnabled()).toBe(true);
  });
});
