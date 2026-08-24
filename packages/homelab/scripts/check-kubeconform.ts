// Validates the cdk8s synth output against the cluster's Kubernetes API
// schemas with kubeconform.
//
// Consumes the FINAL dist/ manifests (turbo orders this after
// `@homelab/cdk8s#build`, which runs scripts/patch.ts post-synth), so what is
// validated is exactly what ArgoCD applies.
//
// Schemas are fetched from kubeconform's default upstream location at
// validation time, so this task needs network access in CI. Vendoring is not
// worth it: the schema set for one Kubernetes release is thousands of files.
import { $ } from "bun";
import path from "node:path";

/**
 * CRD-backed kinds that have no upstream JSON schema, skipped by name.
 *
 * Deliberately an explicit allowlist rather than `-ignore-missing-schemas`:
 * that flag treats EVERY unresolvable schema as an intentional skip, so a
 * misspelled `kind`, or one on an API version that has been removed, would be
 * silently passed over — exactly the malformed core resource this gate exists
 * to catch. With a named list, an unknown kind is still fatal.
 *
 * Adding a new CRD to the cluster means adding its kind here; the failure that
 * prompts it is the intended signal, not an obstacle.
 */
const SKIPPED_CRD_KINDS = [
  "AppProject",
  "Application",
  "ClusterQueue",
  "ClusterTunnel",
  "LocalQueue",
  "OnePasswordItem",
  "PodMonitor",
  "Probe",
  "PrometheusRule",
  "ProxyClass",
  "ResourceFlavor",
  "Schedule",
  "ServiceMonitor",
  "TunnelBinding",
  "VolumeSnapshotClass",
  // Zalando postgres-operator's CRD kind really is lower-case.
  "postgresql",
] as const;

/**
 * The cluster's Kubernetes version, read from the single place the repository
 * already states it: the renovate-annotated `KUBECTL_VERSION` in
 * packages/temporal/Dockerfile. Parsed rather than duplicated as a literal so
 * a Renovate bump of that pin cannot leave this validator on a stale schema
 * set — there is no second value to forget to update.
 */
async function clusterKubernetesVersion(
  repositoryRoot: string,
): Promise<string> {
  const dockerfile = `${repositoryRoot}/packages/temporal/Dockerfile`;
  const text = await Bun.file(dockerfile).text();
  const match = /^ARG KUBECTL_VERSION=v(\d+\.\d+\.\d+)$/m.exec(text);
  if (match?.[1] === undefined) {
    throw new Error(
      `could not read ARG KUBECTL_VERSION from ${dockerfile}; the kubeconform gate derives the cluster Kubernetes version from that pin`,
    );
  }
  return match[1];
}

if (import.meta.main) {
  const root = import.meta.dir.replace(/\/scripts$/, "");
  const repositoryRoot = path.resolve(root, "../..");
  const distribution = `${root}/src/cdk8s/dist`;
  const manifests = [
    ...new Bun.Glob("*.k8s.yaml").scanSync({
      cwd: distribution,
      onlyFiles: true,
    }),
  ]
    .sort()
    .map((file) => path.join(distribution, file));
  // Non-vacuity guard: the synth always emits charts, so an empty dist/ means
  // the build did not run (or wrote elsewhere), not that there is nothing to
  // validate.
  if (manifests.length === 0) {
    throw new Error(
      `no *.k8s.yaml manifests in ${distribution}; run \`bunx turbo run build --filter=@homelab/cdk8s\` first`,
    );
  }
  const kubernetesVersion = await clusterKubernetesVersion(repositoryRoot);
  console.log(
    `kubeconform: validating ${manifests.length.toString()} manifest(s) against Kubernetes ${kubernetesVersion}`,
  );
  await $`kubeconform -strict -summary -skip ${SKIPPED_CRD_KINDS.join(",")} -kubernetes-version ${kubernetesVersion} ${manifests}`;
}
