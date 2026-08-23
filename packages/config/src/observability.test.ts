import { describe, expect, test } from "vitest";
import { z } from "zod";
import { defineConfig } from "@shepherdjerred/config/index.ts";
import { createEnvSource } from "@shepherdjerred/config/sources/env.ts";
import {
  CONFIG_METRIC_LABELS,
  createObservabilityHooks,
  type MetricsRecorder,
  type ResolutionErrorStage,
} from "@shepherdjerred/config/observability.ts";
import type { ConfigSource } from "@shepherdjerred/config/source.ts";

type Recorded = {
  resolutions: { key: string; source: string }[];
  changes: { key: string; source: string }[];
  errors: { key: string; stage: ResolutionErrorStage }[];
  durations: { source: string; seconds: number }[];
};

function recorder(): { metrics: MetricsRecorder; recorded: Recorded } {
  const recorded: Recorded = {
    resolutions: [],
    changes: [],
    errors: [],
    durations: [],
  };
  return {
    recorded,
    metrics: {
      countResolution: (key, source) => {
        recorded.resolutions.push({ key, source });
      },
      countChange: (key, source) => {
        recorded.changes.push({ key, source });
      },
      countError: (key, stage) => {
        recorded.errors.push({ key, stage });
      },
      observeDuration: (source, seconds) => {
        recorded.durations.push({ source, seconds });
      },
    },
  };
}

describe("metric naming", () => {
  test("targetingKey is never a label", () => {
    // It is a guild or user id, so it would be unbounded cardinality. The
    // declared config surface bounds every other label.
    const everyLabel = Object.values(CONFIG_METRIC_LABELS).flat();
    expect(everyLabel).not.toContain("targetingKey");
  });
});

describe("resolver instrumentation", () => {
  test("counts a resolution and its duration, tagged with the answering layer", async () => {
    const { metrics, recorded } = recorder();
    const resolver = defineConfig({
      definition: {
        knob: {
          schema: z.string(),
          sources: ["env", "default"],
          default: "d",
        },
      } as const,
      sources: { env: createEnvSource({ KNOB: "from-env" }) },
      hooks: createObservabilityHooks({ metrics }),
    });

    await resolver.get("knob");
    expect(recorded.resolutions).toEqual([{ key: "knob", source: "env" }]);
    expect(recorded.durations).toHaveLength(1);
    expect(recorded.durations[0]?.source).toBe("env");
  });

  test("a source failure counts an error and still resolves from a lower layer", async () => {
    const { metrics, recorded } = recorder();
    const failing: ConfigSource = {
      name: "flag",
      get: () => Promise.reject(new Error("backend down")),
    };
    const logged: string[] = [];
    const resolver = defineConfig({
      definition: {
        knob: {
          schema: z.string(),
          sources: ["flag", "env", "default"],
          default: "d",
        },
      } as const,
      sources: { flag: failing, env: createEnvSource({ KNOB: "from-env" }) },
      hooks: createObservabilityHooks({
        metrics,
        log: (message) => logged.push(message),
      }),
    });

    await expect(resolver.value("knob")).resolves.toBe("from-env");
    expect(recorded.errors).toEqual([{ key: "knob", stage: "source" }]);
    // The resolution still counts, tagged with the layer that actually
    // answered — the failing layer must not be credited.
    expect(recorded.resolutions).toEqual([{ key: "knob", source: "env" }]);
    expect(logged.some((line) => line.includes("backend down"))).toBe(true);
  });

  test("a change logs old, new, and the source that supplied it", async () => {
    // "I set the env var and nothing happened" is the classic failure of
    // layered config; provenance in the change line is what answers it.
    const { metrics, recorded } = recorder();
    const logged: string[] = [];
    let current = "a";
    const resolver = defineConfig({
      definition: {
        knob: {
          schema: z.string(),
          sources: ["flag", "default"],
          default: "d",
        },
      } as const,
      sources: {
        flag: { name: "flag", get: () => Promise.resolve({ value: current }) },
      },
      hooks: createObservabilityHooks({
        metrics,
        log: (message) => logged.push(message),
      }),
    });

    await resolver.get("knob");
    current = "b";
    await resolver.get("knob");

    expect(recorded.changes).toEqual([{ key: "knob", source: "flag" }]);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('"a" -> "b"');
    expect(logged[0]).toContain("source: flag");
  });

  test("does not log per resolution", async () => {
    // Config reads sit on hot paths; a line per read would bury the changes
    // that actually matter.
    const logged: string[] = [];
    const resolver = defineConfig({
      definition: {
        knob: { schema: z.string(), sources: ["env", "default"], default: "d" },
      } as const,
      sources: { env: createEnvSource({ KNOB: "stable" }) },
      hooks: createObservabilityHooks({
        log: (message) => logged.push(message),
      }),
    });

    await resolver.get("knob");
    await resolver.get("knob");
    await resolver.get("knob");
    expect(logged).toEqual([]);
  });
});
