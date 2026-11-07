import { expect, test } from "vitest";
import { callGraphTracingDefault } from "./call-graph-tracing.ts";

test("a production process consuming beta Flipt retains the beta tracing default", () => {
  const bootstrap = {
    FEATURE_FLAGS_MODE: "flipt",
    FLIPT_URL: "http://flipt.invalid",
    FLIPT_NAMESPACE: "temporal",
  };
  expect(
    callGraphTracingDefault(
      { ...bootstrap, FLIPT_ENVIRONMENT: "beta" },
      "production",
    ),
  ).toBe(false);
  expect(
    callGraphTracingDefault(
      { ...bootstrap, FLIPT_ENVIRONMENT: "prod" },
      "beta",
    ),
  ).toBe(true);
  expect(() =>
    callGraphTracingDefault(
      { ...bootstrap, FLIPT_ENVIRONMENT: "unknown" },
      "production",
    ),
  ).toThrow("unknown managed environment");
});

test("explicit disabled providers use the workload's declared default", () => {
  expect(
    callGraphTracingDefault({ FEATURE_FLAGS_MODE: "disabled" }, "production"),
  ).toBe(true);
  expect(
    callGraphTracingDefault({ FEATURE_FLAGS_MODE: "disabled" }, "beta"),
  ).toBe(false);
});
