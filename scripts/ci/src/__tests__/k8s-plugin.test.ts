import { describe, expect, it } from "bun:test";
import { k8sPlugin } from "../lib/k8s-plugin.ts";

describe("k8sPlugin", () => {
  it("returns default resources when no options given", () => {
    const plugin = k8sPlugin();
    const c0 = plugin.kubernetes.podSpecPatch.containers[0]!;
    const requests = c0.resources.requests;

    expect(requests.cpu).toBe("100m");
    expect(requests.memory).toBe("256Mi");
  });

  it("uses custom resources when provided", () => {
    const plugin = k8sPlugin({ cpu: "2", memory: "4Gi" });
    const c0 = plugin.kubernetes.podSpecPatch.containers[0]!;
    const requests = c0.resources.requests;

    expect(requests.cpu).toBe("2");
    expect(requests.memory).toBe("4Gi");
  });

  it("sets default resource limits when no options given", () => {
    const plugin = k8sPlugin();
    const c0 = plugin.kubernetes.podSpecPatch.containers[0]!;
    const limits = c0.resources.limits;

    expect(limits.cpu).toBe("400m");
    expect(limits.memory).toBe("768Mi");
  });

  it("uses custom resource limits when provided", () => {
    const plugin = k8sPlugin({
      cpu: "2",
      memory: "4Gi",
      cpuLimit: "4",
      memoryLimit: "8Gi",
    });
    const c0 = plugin.kubernetes.podSpecPatch.containers[0]!;
    const limits = c0.resources.limits;

    expect(limits.cpu).toBe("4");
    expect(limits.memory).toBe("8Gi");
  });

  it("falls back the limit to the request when a caller passes a custom request without a matching limit (regression: request must never exceed limit)", () => {
    // Several existing call sites (helm.ts, npm.ts, tofu.ts) pass a custom
    // cpu/memory request above the fixed "400m"/"768Mi" default limit,
    // without passing cpuLimit/memoryLimit. Kubernetes rejects a pod whose
    // request exceeds its limit, so the limit must fall back to at least the
    // request, not the fixed default.
    const plugin = k8sPlugin({ cpu: "500m", memory: "1Gi" });
    const c0 = plugin.kubernetes.podSpecPatch.containers[0]!;
    const requests = c0.resources.requests;
    const limits = c0.resources.limits;

    expect(limits.cpu).toBe("500m");
    expect(limits.memory).toBe("1Gi");
    expect(requests.cpu).toBe(limits.cpu);
    expect(requests.memory).toBe(limits.memory);
  });

  it("includes _EXPERIMENTAL_DAGGER_RUNNER_HOST env var", () => {
    const plugin = k8sPlugin();
    const json = JSON.stringify(plugin);
    expect(json).toContain("_EXPERIMENTAL_DAGGER_RUNNER_HOST");
    expect(json).toContain("tcp://dagger-engine.dagger.svc.cluster.local:8080");
  });

  it("includes default buildkite-ci-secrets", () => {
    const plugin = k8sPlugin();
    const json = JSON.stringify(plugin);
    expect(json).toContain("buildkite-ci-secrets");
  });

  it("adds additional secrets when specified", () => {
    const plugin = k8sPlugin({ secrets: ["buildkite-argocd-token"] });
    const json = JSON.stringify(plugin);
    expect(json).toContain("buildkite-argocd-token");
  });

  it("skips Buildkite-managed checkout (Dagger fetches source via git URL refs)", () => {
    const plugin = k8sPlugin();
    expect(plugin.kubernetes.checkout.skip).toBe(true);
  });

  it("does not mount buildkite-git-mirrors PVC anywhere", () => {
    const plugin = k8sPlugin();
    const json = JSON.stringify(plugin);
    expect(json).not.toContain("buildkite-git-mirrors");
  });
});
