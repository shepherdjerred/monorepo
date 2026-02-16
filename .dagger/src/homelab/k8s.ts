import { Directory } from "@dagger.io/dagger";
import { buildK8sManifests } from "./cdk8s";
import { getKubectlContainer } from "./base";

/**
 * Applies Kubernetes manifests from the specified directory using kubectl.
 * Uses caching for improved performance.
 * @param source The source directory containing Kubernetes manifests.
 * @param manifestsPath The path within the source directory to the manifests (default: "manifests").
 * @returns The stdout from the kubectl apply command.
 */
export async function applyK8sConfig(source: Directory, manifestsPath = "manifests"): Promise<string> {
  // Write output to file then read to avoid Dagger SDK URLSearchParams.toJSON bug
  const container = getKubectlContainer()
    .withMountedDirectory("/workspace", source)
    .withWorkdir(`/workspace/${manifestsPath}`)
    .withExec(["sh", "-c", "kubectl apply -f . --dry-run=client > /tmp/result.txt 2>&1"]); // Remove --dry-run=client for real apply
  return container.file("/tmp/result.txt").contents();
}

/**
 * Builds manifests with CDK8s and applies them to the cluster using kubectl.
 * @param source The repository root directory.
 * @returns The stdout from the kubectl apply command.
 */
export async function buildAndApplyCdk8s(source: Directory): Promise<string> {
  const manifestsDir = buildK8sManifests(source);
  return applyK8sConfig(manifestsDir, ".");
}
