import { Counter, Gauge, type Registry } from "prom-client";
import {
  createFlagMetricsRecorder,
  createFlagMetricSet,
} from "@shepherdjerred/feature-flags/observability.ts";
import {
  managedFlagInventory,
  materializeManagedNamespaceEnvironment,
  type ManagedFlagInventory,
} from "@shepherdjerred/feature-flags/managed-flag-inventory.ts";
import {
  FLAG_ROLLOUT_STATES,
  classifySnapshotBoolean,
} from "@shepherdjerred/feature-flags/rollout-state.ts";
import type { FliptSnapshot } from "@shepherdjerred/feature-flags/managed-flag-drift.ts";
import { register } from "./metrics.ts";

const pairLabels = ["flipt_environment", "flipt_namespace"] as const;
const flagLabels = [...pairLabels, "flag"] as const;
const exceptionLabels = [...flagLabels, "issue"] as const;

/** A caller updates only successfully parsed snapshots; failures retain the last good timestamp. */
export function createFlagInventoryMetrics(
  registry: Registry,
  inventory: ManagedFlagInventory = managedFlagInventory,
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
    help: "Expected Flipt environment and namespace observations",
    labelNames: pairLabels,
    registers: [registry],
  });
  const previous = new Map<string, { flag: string; issue: string }[]>();
  const previousFlags = new Map<string, string[]>();
  for (const environment of inventory.environments) {
    for (const namespace of inventory.namespaces)
      expected.set(
        { flipt_environment: environment.key, flipt_namespace: namespace.key },
        1,
      );
  }
  return {
    observePair(
      environment: string,
      namespace: string,
      snapshot: FliptSnapshot,
      at: Date,
    ): void {
      const declared = materializeManagedNamespaceEnvironment(
        inventory,
        environment,
        namespace,
      );
      const live = new Map(snapshot.flags.map((flag) => [flag.key, flag]));
      const flags = declared.flatMap((flag) =>
        flag.type === "boolean"
          ? [{ flag, state: classifySnapshotBoolean(live.get(flag.key)) }]
          : [],
      );
      const timestamp = at.getTime() / 1000;
      if (!Number.isFinite(timestamp))
        throw new TypeError("Invalid Flipt observation timestamp");
      const labels = {
        flipt_environment: environment,
        flipt_namespace: namespace,
      };
      const key = `${environment}/${namespace}`;
      for (const old of previous.get(key) ?? []) {
        exception.remove({ ...labels, ...old });
        review.remove({ ...labels, ...old });
      }
      const removed = (previousFlags.get(key) ?? []).filter(
        (old) => !flags.some(({ flag }) => flag.key === old),
      );
      for (const old of removed) {
        for (const value of FLAG_ROLLOUT_STATES)
          state.remove({ ...labels, flag: old, state: value });
      }
      const exceptions: { flag: string; issue: string }[] = [];
      for (const item of flags) {
        const flagIdentity = { ...labels, flag: item.flag.key };
        for (const value of FLAG_ROLLOUT_STATES)
          state.set(
            { ...flagIdentity, state: value },
            value === item.state ? 1 : 0,
          );
        const scopedExceptions = (item.flag.defaultOffExceptions ?? []).filter(
          (entry) => entry.environment === environment,
        );
        for (const entry of scopedExceptions) {
          const identity = { ...flagIdentity, issue: entry.issue };
          exception.set(identity, 1);
          review.set(
            identity,
            Date.parse(`${entry.reviewBy}T23:59:59Z`) / 1000,
          );
          exceptions.push({ flag: item.flag.key, issue: entry.issue });
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
