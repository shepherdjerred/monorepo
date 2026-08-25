/**
 * One dependency movement in a release's summary.
 *
 * Shared between the summariser and the modules it delegates to for OCI
 * manifests and release notes. Those helpers consume the type, so declaring it
 * beside the summariser made them import it back — an import cycle.
 */

export type DependencyChangeKind =
  "upstream-upgrade" | "internal-promotion" | "addition" | "removal" | "revert";

export type DependencyChange = {
  name: string;
  category: "upstream" | "internal-image";
  artifactType: "image" | "helm-chart" | "package" | "source";
  datasource: string | undefined;
  registryUrl: string | undefined;
  packageName: string | undefined;
  oldValue: string | undefined;
  newValue: string | undefined;
  oldVersion: string | undefined;
  newVersion: string | undefined;
  kind: DependencyChangeKind;
  commitSha: string;
  commitSubject: string;
  releaseNotesOverride:
    { url?: string | undefined; summary: string } | undefined;
};
