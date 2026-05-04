import { describe, expect, it } from "bun:test";
import { daggerStep, plainStep, DAGGER_ENV } from "../lib/buildkite.ts";

describe("daggerStep — OTel env shape", () => {
  // Regression guard: every dagger CI step must carry the OTel env that lets
  // Dagger's CLI ship traces to Tempo. If someone reverts or trims the env
  // block in daggerStep (e.g. while debugging an unrelated CI issue), this
  // test fails before the change reaches main. See plan: confidence checks
  // for Tempo wiring.

  it("includes the base OTLP endpoint and protocol from DAGGER_ENV", () => {
    const step = daggerStep({
      label: "dummy",
      key: "dummy-step",
      daggerCmd: "dagger call dummy",
    });
    expect(step.env).toBeDefined();
    expect(step.env?.["OTEL_EXPORTER_OTLP_ENDPOINT"]).toBe(
      "http://tempo.tempo.svc.cluster.local:4318",
    );
    expect(step.env?.["OTEL_EXPORTER_OTLP_PROTOCOL"]).toBe("http/protobuf");
  });

  it("overrides OTEL_SERVICE_NAME with a per-step value derived from key", () => {
    const step = daggerStep({
      label: "typecheck temporal",
      key: "test-temporal",
      daggerCmd: "dagger call test --pkg temporal",
    });
    expect(step.env?.["OTEL_SERVICE_NAME"]).toBe("dagger-ci-test-temporal");
  });

  it("emits OTEL_RESOURCE_ATTRIBUTES with Buildkite vars and step key baked in", () => {
    const step = daggerStep({
      label: "dummy",
      key: "smoke-build-images",
      daggerCmd: "dagger call dummy",
    });
    const attrs = step.env?.["OTEL_RESOURCE_ATTRIBUTES"];
    expect(attrs).toBeDefined();
    expect(attrs).toContain("service.namespace=monorepo");
    expect(attrs).toContain("deployment.environment=ci");
    // Build-level vars use single $ — interpolated by `buildkite-agent
    // pipeline upload`. Step key is embedded directly at gen time.
    expect(attrs).toContain("buildkite.build.number=$BUILDKITE_BUILD_NUMBER");
    expect(attrs).toContain("buildkite.branch=$BUILDKITE_BRANCH");
    expect(attrs).toContain("buildkite.commit=$BUILDKITE_COMMIT");
    expect(attrs).toContain("buildkite.pipeline=$BUILDKITE_PIPELINE_SLUG");
    expect(attrs).toContain("buildkite.step.key=smoke-build-images");
  });

  it("does NOT enable live trace export (Tempo expects ended spans)", () => {
    const step = daggerStep({
      label: "dummy",
      key: "dummy",
      daggerCmd: "dagger call dummy",
    });
    expect(step.env?.["OTEL_EXPORTER_OTLP_TRACES_LIVE"]).toBeUndefined();
  });
});

describe("DAGGER_ENV", () => {
  it("does not set logs/metrics endpoints (Tempo only handles traces)", () => {
    // If someone copies generic OTLP_ENDPOINT into the logs/metrics fields by
    // mistake, Dagger will try to POST to Tempo and get 404s. Guard against
    // that. Logs go to Loki, metrics to Prometheus — wired separately when
    // those follow-ups land.
    expect(DAGGER_ENV["OTEL_EXPORTER_OTLP_LOGS_ENDPOINT"]).toBeUndefined();
    expect(DAGGER_ENV["OTEL_EXPORTER_OTLP_METRICS_ENDPOINT"]).toBeUndefined();
  });
});

describe("plainStep — does NOT carry OTel env", () => {
  it("plain steps don't run dagger; OTel env would be wasted/confusing", () => {
    const step = plainStep({
      label: "lint",
      key: "lint",
      command: "bun run lint",
    });
    expect(step.env).toBeUndefined();
  });
});
