import type { MountBindingRequest } from "#shared/legacy-observer.ts";
import type { QuiescenceEvidence } from "#shared/legacy-observer.ts";
import type { LoadedHandoffPlan } from "./plan.ts";
import { protectedEvidence, type HandoffNetworkContext } from "./context.ts";

export async function observeHandoffMounts(
  context: HandoffNetworkContext,
  input: LoadedHandoffPlan,
  quiescence: QuiescenceEvidence,
  signal: AbortSignal,
) {
  const bindings: MountBindingRequest[] = [];
  for (const [kind, deployment, root] of [
    [
      "radarr",
      "media-radarr",
      context.canonicalRoots?.movies ?? "/data/movies",
    ],
    ["sonarr", "media-sonarr", context.canonicalRoots?.tv ?? "/data/tv"],
  ]) {
    if (kind === undefined || deployment === undefined || root === undefined)
      throw new Error("Invalid root registry");
    const captures = input.manifest.captures.filter(
      (capture) => capture.sourceKind === kind,
    );
    const capture = captures[0];
    if (capture === undefined || captures.length !== 1)
      throw protectedEvidence("handoff_manager_instance_ambiguous");
    const mappings = input.manifest.rootMappings.filter(
      (mapping) =>
        mapping.captureId === capture.captureId &&
        mapping.canonicalRoot === root,
    );
    const mapping = mappings[0];
    if (mapping === undefined || mappings.length !== 1)
      throw protectedEvidence("handoff_root_mapping_unproved");
    bindings.push({
      sourceDeployment: deployment,
      sourceContainer: "main",
      sourceRoot: mapping.sourceRoot,
      canonicalDeployment: "media-media-files",
      canonicalContainer: "media-files",
      canonicalRoot: root,
    });
  }
  const evidence = await context.observer.observeMountBindings(
    bindings,
    signal,
  );
  for (const binding of evidence.bindings) {
    const controller = quiescence.controllers.find(
      (item) => item.name === binding.source.deployment,
    );
    if (
      controller?.uid !== binding.source.deploymentUid ||
      controller.specDigest !== binding.source.specDigest ||
      controller.generation !== binding.source.generation
    )
      throw protectedEvidence("handoff_source_mount_changed");
  }
  return evidence;
}
