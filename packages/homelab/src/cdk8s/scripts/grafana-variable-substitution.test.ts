import { describe, expect, it } from "bun:test";
import { replaceGrafanaVariables } from "./grafana-variable-substitution.ts";

describe("Grafana query-audit variable substitution", () => {
  it("substitutes cluster, serial, and volume in both Grafana forms", () => {
    expect(
      replaceGrafanaVariables(
        'metric{cluster=~"$cluster",serial=~"${serial}",volume=~"$volume"}',
      ),
    ).toBe('metric{cluster=~".*",serial=~".*",volume=~".*"}');
  });

  it("substitutes established variables and deterministic intervals", () => {
    expect(
      replaceGrafanaVariables(
        'metric{namespace=~"${namespace}",instance=~"$instance",namespace!="$NAMESPACE"}[$__rate_interval] / $__interval',
      ),
    ).toBe(
      'metric{namespace=~".*",instance=~".*",namespace!="seaweedfs"}[5m] / 5m',
    );
  });
});
