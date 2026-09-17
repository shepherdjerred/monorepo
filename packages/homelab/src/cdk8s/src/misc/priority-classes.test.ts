import { Testing } from "cdk8s";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { KubePriorityClass } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import {
  BATCH_PRIORITY,
  BURST_SERVICE_PRIORITY,
  createPriorityClasses,
  INFRASTRUCTURE_PRIORITY,
  SERVICE_PRIORITY,
} from "./priority-classes.ts";

const PriorityClassSchema = z.object({
  apiVersion: z.literal("scheduling.k8s.io/v1"),
  kind: z.literal("PriorityClass"),
  metadata: z.object({ name: z.string() }),
  value: z.number(),
});

describe("priority classes", () => {
  test("createPriorityClasses uses the generated KubePriorityClass import", () => {
    expect(KubePriorityClass.GVK).toEqual({
      apiVersion: "scheduling.k8s.io/v1",
      kind: "PriorityClass",
    });

    const chart = Testing.chart();
    createPriorityClasses(chart);
    const classes = Testing.synth(chart).flatMap((document) => {
      const parsed = PriorityClassSchema.safeParse(document);
      return parsed.success ? [parsed.data] : [];
    });

    expect(classes.map((item) => item.metadata.name).sort()).toEqual(
      [
        BATCH_PRIORITY,
        BURST_SERVICE_PRIORITY,
        INFRASTRUCTURE_PRIORITY,
        SERVICE_PRIORITY,
      ].sort(),
    );
    expect(
      classes.find((item) => item.metadata.name === BURST_SERVICE_PRIORITY)
        ?.value,
    ).toBe(100_000);
  });
});
