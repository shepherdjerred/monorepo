import { describe, expect, it } from "vitest";
import { replaceGrafanaVariables } from "./grafana-variable-substitution.ts";

describe("Grafana query-audit variable substitution", () => {
  it("substitutes regex matchers in both Grafana forms", () => {
    expect(
      replaceGrafanaVariables(
        'metric{cluster=~"$cluster",serial=~"${serial}",volume=~"$volume"}',
      ),
    ).toBe('metric{cluster=~".*",serial=~".*",volume=~".*"}');
  });

  it("rewrites equality matchers on variables instead of matching the literal string", () => {
    expect(
      replaceGrafanaVariables(
        'metric{cluster="$cluster", job="kubelet", metrics_path="/metrics"}',
      ),
    ).toBe('metric{cluster=~".*", job="kubelet", metrics_path="/metrics"}');
  });

  it("handles anchored variable references", () => {
    expect(replaceGrafanaVariables('metric{instance=~"^$instance$"}')).toBe(
      'metric{instance=~".*"}',
    );
  });

  it("neutralizes negative matchers on variables so they keep every series", () => {
    expect(
      replaceGrafanaVariables('metric{namespace!="$NAMESPACE",pod!~"$pod"}'),
    ).toBe(String.raw`metric{namespace!~"[^\\s\\S]",pod!~"[^\\s\\S]"}`);
  });

  it("leaves literal negative matchers untouched", () => {
    expect(replaceGrafanaVariables('metric{container!=""}')).toBe(
      'metric{container!=""}',
    );
  });

  it("substitutes deterministic intervals and leftover variables", () => {
    expect(
      replaceGrafanaVariables(
        "rate(metric[$__rate_interval]) / $__interval + avg_over_time(metric[$__range]) and label_values($workload)",
      ),
    ).toBe(
      "rate(metric[5m]) / 5m + avg_over_time(metric[1h]) and label_values(.*)",
    );
  });
});
