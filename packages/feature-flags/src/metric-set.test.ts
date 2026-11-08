import { expect, test } from "vitest";
import {
  createFlagMetricSet,
  createFlagMetricsRecorder,
  type FlagMetricFactory,
} from "./observability.ts";

function applicationMetrics() {
  const observations: unknown[] = [];
  const definitions: unknown[] = [];
  const factory: FlagMetricFactory = {
    counter: (definition) => {
      definitions.push(definition);
      return {
        inc: (labels) => observations.push([definition.name, labels]),
      };
    },
    gauge: (definition) => {
      definitions.push(definition);
      return {
        reset: () => observations.push([definition.name, "reset"]),
        set: (
          labelsOrValue: number | Readonly<Record<string, string>>,
          value?: number,
        ) => {
          observations.push([definition.name, labelsOrValue, value]);
        },
      };
    },
  };
  return {
    observations,
    definitions,
    recorder: createFlagMetricsRecorder(createFlagMetricSet(factory)),
  };
}

test("applications retain independent metric ownership and bounded shared labels", () => {
  const first = applicationMetrics();
  const second = applicationMetrics();
  first.recorder.countEvaluation({
    flag: "known",
    reason: "STATIC",
    value: "false",
    errorCode: undefined,
  });
  first.recorder.observeProviderReady(true);
  first.recorder.observeProviderInfo({
    flipt_environment: "prod",
    flipt_namespace: "test",
  });
  first.recorder.observeProviderInfo(undefined);

  expect(second.observations).toEqual([]);
  expect(first.definitions).toHaveLength(5);
  expect(first.definitions).toContainEqual({
    name: "feature_flag_evaluations_total",
    help: "Feature flag evaluations by bounded result",
    labelNames: ["flag", "reason", "value"],
  });
  expect(first.observations).toEqual([
    [
      "feature_flag_evaluations_total",
      { flag: "known", reason: "STATIC", value: "false" },
    ],
    ["feature_flag_provider_ready", 1, undefined],
    ["feature_flag_provider_info", "reset"],
    [
      "feature_flag_provider_info",
      { flipt_environment: "prod", flipt_namespace: "test" },
      1,
    ],
    ["feature_flag_provider_info", "reset"],
  ]);
});
