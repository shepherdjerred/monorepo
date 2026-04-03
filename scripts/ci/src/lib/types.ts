/** Affected packages result from change detection. */
export interface AffectedPackages {
  packages: Set<string>;
  buildAll: boolean;
  homelabChanged: boolean;
  clauderonChanged: boolean;
  cooklangChanged: boolean;
  castleCastersChanged: boolean;
  resumeChanged: boolean;
  hasImagePackages: Set<string>;
  hasSitePackages: Set<string>;
  hasNpmPackages: Set<string>;
}

/** A single Buildkite step. */
export interface BuildkiteStep {
  label: string;
  key: string;
  command: string;
  timeout_in_minutes?: number;
  retry?: Record<string, unknown>;
  plugins?: Record<string, unknown>[];
  depends_on?: string | string[];
  if?: string;
  soft_fail?: boolean;
  env?: Record<string, string>;
  parallelism?: number;
  concurrency?: number;
  concurrency_group?: string;
  artifact_paths?: string[];
  allow_dependency_failure?: boolean;
  priority?: number;
}

/** A Buildkite step group. */
export interface BuildkiteGroup {
  group: string;
  key: string;
  steps: BuildkiteStep[];
}

/** A wait step. */
export interface BuildkiteWait {
  wait: string;
  if?: string;
}

/** Any element in a pipeline steps array. */
export type PipelineStep = BuildkiteStep | BuildkiteGroup | BuildkiteWait;

/** The full Buildkite pipeline object. */
export interface BuildkitePipeline {
  agents: { queue: string };
  steps: PipelineStep[];
}
