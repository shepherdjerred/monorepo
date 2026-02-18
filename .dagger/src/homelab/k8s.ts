import type { Directory } from "@dagger.io/dagger";
import { getKubectlContainer } from "./base";

/**
 * Applies Kubernetes manifests from the specified directory using kubectl.
 * Uses caching for improved performance.
 * @param source The source directory containing Kubernetes manifests.
 * @param manifestsPath The path within the source directory to the manifests (default: "manifests").
 * @returns The stdout from the kubectl apply command.
 */
export async function applyK8sConfig(
  source: Directory,
  manifestsPath = "manifests",
): Promise<string> {
  // Write output to file then read to avoid Dagger SDK URLSearchParams.toJSON bug
  const container = getKubectlContainer()
    .withMountedDirectory("/workspace", source)
    .withWorkdir(`/workspace/${manifestsPath}`)
    .withExec([
      "sh",
      "-c",
      "kubectl apply -f . --dry-run=client > /tmp/result.txt 2>&1",
    ]); // Remove --dry-run=client for real apply
  return container.file("/tmp/result.txt").contents();
}
