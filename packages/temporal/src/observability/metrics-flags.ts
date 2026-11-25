import { Counter, Gauge, type Registry } from "prom-client";
import {
  flagDeployments,
  type FlagDeployment,
} from "@shepherdjerred/feature-flags/deployments.ts";
import type { FlagValue } from "@shepherdjerred/feature-flags/evaluate.ts";
import {
  createFlagMetricsRecorder,
  createFlagMetricSet,
} from "@shepherdjerred/feature-flags/observability.ts";
import {
  managedFlagInventory,
  materializeManagedNamespaceEnvironment,
  type DefaultOffException,
  type ManagedFlagInventory,
} from "@shepherdjerred/feature-flags/managed-flag-inventory.ts";
import {
  FLAG_ROLLOUT_STATES,
  classifyFlagBoolean,
} from "@shepherdjerred/feature-flags/rollout-state.ts";
import { register } from "./metrics.ts";

const pairLabels = ["deployment"] as const;
const flagLabels = [...pairLabels, "flag"] as const;
const exceptionLabels = [...flagLabels, "issue"] as const;

function recordScopedException(
  entry: DefaultOffException,
  flagIdentity: {
    deployment: string;
    flag: string;
  },
  gauges: {
    exception: Gauge<(typeof exceptionLabels)[number]>;
    review: Gauge<(typeof exceptionLabels)[number]>;
  },
): { flag: string; issue: string } {
  const identity = { ...flagIdentity, issue: entry.issue };
  gauges.exception.set(identity, 1);
  if (entry.reviewBy !== undefined) {
    gauges.review.set(
      identity,
      Date.parse(`${entry.reviewBy}T23:59:59Z`) / 1000,
    );
  }
  return { flag: flagIdentity.flag, issue: entry.issue };
}

/** A caller updates only successfully parsed documents; failures retain the last good timestamp. */
export function createFlagInventoryMetrics(
  registry: Registry,
  inventory: ManagedFlagInventory = managedFlagInventory,
  deployments: readonly FlagDeployment[] = flagDeployments,
) {
  const state = new Gauge({
    name: "feature_flag_rollout_state",
    help: "One-hot live boolean rollout state; configuration does not imply consumer availability",
    labelNames: [...flagLabels, "state"] as const,
    registers: [registry],
  });
  const exception = new Gauge({
    name: "feature_flag_default_off_exception",
    help: "Declared default-off or targeted exception linked to its review issue",
    labelNames: exceptionLabels,
    registers: [registry],
  });
  const review = new Gauge({
    name: "feature_flag_exception_review_timestamp_seconds",
    help: "UTC end-of-day deadline for reviewing a declared exception",
    labelNames: exceptionLabels,
    registers: [registry],
  });
  const observed = new Gauge({
    name: "feature_flag_inventory_observed_timestamp_seconds",
    help: "Most recent successful inventory snapshot observation",
    labelNames: pairLabels,
    registers: [registry],
  });
  const expected = new Gauge({
    name: "feature_flag_inventory_expected",
    help: "Expected Flags deployment inventory observations",
    labelNames: pairLabels,
    registers: [registry],
  });
  const expectedIds = new Set(deployments.map((deployment) => deployment.id));
  const previous = new Map<string, { flag: string; issue: string }[]>();
  const previousFlags = new Map<string, string[]>();
  for (const deployment of deployments) {
    expected.set(
      {
        deployment: deployment.id,
      },
      1,
    );
  }
  return {
    observeDeployment(
      deployment: FlagDeployment,
      liveFlags: readonly FlagValue[],
      at: Date,
    ): void {
      if (!expectedIds.has(deployment.id)) {
        throw new Error(
          `Unexpected flag deployment observation: ${deployment.id}`,
        );
      }
      const declared = materializeManagedNamespaceEnvironment(
        inventory,
        deployment.stage,
        deployment.catalog,
      );
      const live = new Map(liveFlags.map((flag) => [flag.key, flag]));
      const flags = declared.flatMap((flag) =>
        flag.type === "boolean"
          ? [{ flag, state: classifyFlagBoolean(live.get(flag.key)) }]
          : [],
      );
      const timestamp = at.getTime() / 1000;
      if (!Number.isFinite(timestamp)) {
        throw new TypeError("Invalid flag observation timestamp");
      }
      const labels = {
        deployment: deployment.id,
      };
      const key = deployment.id;
      for (const old of previous.get(key) ?? []) {
        exception.remove({ ...labels, ...old });
        review.remove({ ...labels, ...old });
      }
      const removed = (previousFlags.get(key) ?? []).filter(
        (old) => !flags.some(({ flag }) => flag.key === old),
      );
      for (const old of removed) {
        for (const value of FLAG_ROLLOUT_STATES) {
          state.remove({ ...labels, flag: old, state: value });
        }
      }
      const exceptions: { flag: string; issue: string }[] = [];
      for (const item of flags) {
        const flagIdentity = { ...labels, flag: item.flag.key };
        for (const value of FLAG_ROLLOUT_STATES) {
          state.set(
            { ...flagIdentity, state: value },
            value === item.state ? 1 : 0,
          );
        }
        const scopedExceptions = (item.flag.defaultOffExceptions ?? []).filter(
          (entry) => entry.environment === deployment.stage,
        );
        for (const entry of scopedExceptions) {
          exceptions.push(
            recordScopedException(entry, flagIdentity, { exception, review }),
          );
        }
      }
      previous.set(key, exceptions);
      previousFlags.set(
        key,
        flags.map(({ flag }) => flag.key),
      );
      observed.set(labels, timestamp);
    },
  };
}

export const flagInventoryMetrics = createFlagInventoryMetrics(register);

export const featureFlagMetrics = createFlagMetricsRecorder(
  createFlagMetricSet({
    counter: (definition) =>
      new Counter({ ...definition, registers: [register] }),
    gauge: (definition) => new Gauge({ ...definition, registers: [register] }),
  }),
);
