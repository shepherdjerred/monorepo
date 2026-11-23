import { expect, test } from "bun:test";
import {
  workerErrorEnvelope,
  restoreWorkerError,
} from "./latest-worker-errors.mjs";

test("worker failures preserve original stack, type and causal error through actual clone", () => {
  const original = new RangeError("Too many properties to enumerate", {
    cause: new Error("Decoded column preparation"),
  });
  const restored = restoreWorkerError(
    structuredClone(workerErrorEnvelope(original)),
  );
  expect(restored.name).toBe("RangeError");
  expect(restored.message).toBe(original.message);
  expect(restored.stack).toBe(original.stack);
  expect(restored.cause).toBeInstanceOf(RangeError);
  expect(restored.cause.cause.message).toBe("Decoded column preparation");
});

test("non-Error rejections remain useful and malformed error envelopes fail", () => {
  expect(
    restoreWorkerError(structuredClone(workerErrorEnvelope("worker rejected")))
      .message,
  ).toBe("worker rejected");
  expect(() =>
    restoreWorkerError({ name: "Error", message: "bad", stack: 7 }),
  ).toThrow("Invalid worker error response");
  expect(() =>
    restoreWorkerError({ name: "Error", message: "bad", cause: {} }),
  ).toThrow("Invalid worker error response");
});
