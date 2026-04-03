/** CI base image — kept in sync with .buildkite/ci-image/VERSION. */
const CI_BASE_IMAGE = "ghcr.io/shepherdjerred/ci-base:404";

/** Build the Kubernetes plugin config for a Buildkite step. */
export function k8sPlugin(
  opts: {
    cpu?: string;
    memory?: string;
    secrets?: string[];
  } = {},
): Record<string, unknown> {
  const secretRefs: Record<string, unknown>[] = [
    { secretRef: { name: "buildkite-ci-secrets" } },
  ];

  for (const s of opts.secrets ?? []) {
    secretRefs.push({ secretRef: { name: s, optional: true } });
  }

  return {
    kubernetes: {
      checkout: {
        cloneFlags: "--depth=100",
        fetchFlags: "--depth=100",
      },
      podSpecPatch: {
        serviceAccountName: "buildkite-agent-stack-k8s-controller",
        containers: [
          {
            name: "container-0",
            image: CI_BASE_IMAGE,
            resources: {
              requests: {
                cpu: opts.cpu ?? "100m",
                memory: opts.memory ?? "256Mi",
              },
            },
            env: [
              {
                name: "_EXPERIMENTAL_DAGGER_RUNNER_HOST",
                value: "tcp://dagger-engine.dagger.svc.cluster.local:8080",
              },
            ],
            envFrom: secretRefs,
            volumeMounts: [
              {
                name: "buildkite-git-mirrors",
                mountPath: "/buildkite/git-mirrors",
                readOnly: true,
              },
            ],
          },
        ],
      },
    },
  };
}
