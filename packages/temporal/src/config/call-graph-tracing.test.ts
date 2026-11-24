import { expect, test } from "vitest";
import { callGraphTracingDefault } from "./call-graph-tracing.ts";

test("a production process consuming a beta Flags deployment retains the beta tracing default", () => {
  const bootstrap = {
    FEATURE_FLAGS_MODE: "flags",
    FLAGS_URL: "http://flags.invalid:7361",
  };
  expect(
    callGraphTracingDefault(
      { ...bootstrap, FLAGS_DEPLOYMENT: "temporal/beta" },
      "production",
    ),
  ).toBe(false);
  expect(
    callGraphTracingDefault(
      { ...bootstrap, FLAGS_DEPLOYMENT: "temporal/prod" },
      "beta",
    ),
  ).toBe(true);
  expect(() =>
    callGraphTracingDefault(
      { ...bootstrap, FLAGS_DEPLOYMENT: "temporal/unknown" },
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
