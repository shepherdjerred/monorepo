import { describe, expect, it } from "bun:test";
import { k8sPlugin } from "../lib/k8s-plugin.ts";

describe("k8sPlugin", () => {
  it("returns default resources when no options given", () => {
    const plugin = k8sPlugin() as Record<string, unknown>;
    const k8s = plugin["kubernetes"] as Record<string, unknown>;
    const pod = k8s["podSpecPatch"] as Record<string, unknown>;
    const containers = pod["containers"] as Record<string, unknown>[];
    const c0 = containers[0]!;
    const resources = c0["resources"] as Record<string, unknown>;
    const requests = resources["requests"] as Record<string, string>;

    expect(requests["cpu"]).toBe("500m");
    expect(requests["memory"]).toBe("1Gi");
  });

  it("uses custom resources when provided", () => {
    const plugin = k8sPlugin({ cpu: "2", memory: "4Gi" }) as Record<
      string,
      unknown
    >;
    const k8s = plugin["kubernetes"] as Record<string, unknown>;
    const pod = k8s["podSpecPatch"] as Record<string, unknown>;
    const containers = pod["containers"] as Record<string, unknown>[];
    const c0 = containers[0]!;
    const resources = c0["resources"] as Record<string, unknown>;
    const requests = resources["requests"] as Record<string, string>;

    expect(requests["cpu"]).toBe("2");
    expect(requests["memory"]).toBe("4Gi");
  });

  it("includes _EXPERIMENTAL_DAGGER_RUNNER_HOST env var", () => {
    const plugin = k8sPlugin() as Record<string, unknown>;
    const json = JSON.stringify(plugin);
    expect(json).toContain("_EXPERIMENTAL_DAGGER_RUNNER_HOST");
    expect(json).toContain("tcp://dagger-engine.dagger.svc.cluster.local:8080");
  });

  it("includes default buildkite-ci-secrets", () => {
    const plugin = k8sPlugin() as Record<string, unknown>;
    const json = JSON.stringify(plugin);
    expect(json).toContain("buildkite-ci-secrets");
  });

  it("adds additional secrets when specified", () => {
    const plugin = k8sPlugin({ secrets: ["buildkite-argocd-token"] }) as Record<
      string,
      unknown
    >;
    const json = JSON.stringify(plugin);
    expect(json).toContain("buildkite-argocd-token");
  });

  it("includes shallow clone flags", () => {
    const plugin = k8sPlugin() as Record<string, unknown>;
    const k8s = plugin["kubernetes"] as Record<string, unknown>;
    const checkout = k8s["checkout"] as Record<string, string>;
    expect(checkout["cloneFlags"]).toContain("--depth=100");
  });
});
