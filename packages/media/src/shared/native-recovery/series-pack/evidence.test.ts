import { expect, test } from "vitest";
import { ClosedCoordinatorObservationSchema } from "#shared/publication-proof/references.ts";
import { SeriesPackNativeAcquisitionClosedV1Schema } from "./evidence.ts";

test("an acquisition closure binds its actual attempt independently of the operation coordinator", () => {
  const operationId = crypto.randomUUID();
  const attemptId = crypto.randomUUID();
  const child = {
    operationId,
    attemptId,
    workflowId: `media-acquire-${attemptId}`,
    runId: crypto.randomUUID(),
    status: "TERMINATED",
    observedAt: new Date().toISOString(),
  };
  expect(SeriesPackNativeAcquisitionClosedV1Schema.parse(child)).toEqual(child);
  const { attemptId: _attemptId, ...originalChildFields } = child;
  expect(
    ClosedCoordinatorObservationSchema.safeParse(originalChildFields).success,
  ).toBe(false);
  const root = {
    ...originalChildFields,
    workflowId: `media-operation-${operationId}`,
  };
  expect(ClosedCoordinatorObservationSchema.parse(root)).toEqual(root);
  expect(
    SeriesPackNativeAcquisitionClosedV1Schema.safeParse({
      ...child,
      attemptId: crypto.randomUUID(),
    }).success,
  ).toBe(false);
  expect(
    SeriesPackNativeAcquisitionClosedV1Schema.safeParse({
      ...child,
      workflowId: `media-operation-${operationId}`,
    }).success,
  ).toBe(false);
  expect(
    SeriesPackNativeAcquisitionClosedV1Schema.safeParse({
      ...child,
      status: "RUNNING",
    }).success,
  ).toBe(false);
  expect(
    SeriesPackNativeAcquisitionClosedV1Schema.safeParse({ ...child, runId: "" })
      .success,
  ).toBe(false);
});
