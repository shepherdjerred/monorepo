import type { ApiObjectMetadata } from "cdk8s";
import type { Construct } from "constructs";
import {
  Application,
  type ApplicationSpec,
  type ApplicationSpecIgnoreDifferences,
  type ApplicationSpecSource,
  type ApplicationSpecSourceHelm,
  type ApplicationSpecSyncPolicy,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import type {
  HelmChartName,
  HelmValuesForChart,
} from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";
import {
  applicationProject,
  IN_CLUSTER_SERVER,
} from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/projects.ts";

/** The chart repository every first-party wrapper chart is published to. */
export const FIRST_PARTY_CHART_REPOSITORY =
  "https://chartmuseum.tailnet-1a49.ts.net";
/** Tracks the newest published 2.x wrapper chart, prereleases included. */
export const FIRST_PARTY_CHART_REVISION = "~2.0.0-0";
/** The history depth every Application keeps unless it says otherwise. */
export const DEFAULT_REVISION_HISTORY_LIMIT = 5;

/**
 * What every Application states, whatever its source.
 *
 * `syncPolicy` is required and has no default: the fleet's policies differ
 * (`automated: {}` against `{ enabled: true }`, `prune`, `selfHeal`, a missing
 * `CreateNamespace`), and an Application body is a Delivery recipe revision,
 * so each call site spells out the policy it renders. Pass `undefined` for an
 * Application that renders no sync policy at all.
 */
export type ArgoApplicationOptions = {
  /** `metadata.name`, and the name its AppProject is looked up by. */
  name: string;
  /** The cdk8s construct id. Defaults to `<name>-app`. */
  id?: string;
  /** The destination namespace on the in-cluster server. */
  namespace: string;
  syncPolicy: ApplicationSpecSyncPolicy | undefined;
  ignoreDifferences?: ApplicationSpecIgnoreDifferences[];
  /** `null` renders no limit, leaving ArgoCD's own default in force. */
  revisionHistoryLimit?: number | null;
  /** Metadata beyond the name: annotations, an explicit namespace. */
  metadata?: Omit<ApiObjectMetadata, "name">;
  /**
   * Escape hatch: spec fields merged over everything the factory derived.
   * Reach for it only when no option above can say what is needed.
   */
  spec?: Partial<ApplicationSpec>;
};

/**
 * An Application from any source. The Helm factories below are built on it;
 * call it directly only for a source that is not a Helm chart.
 */
export function argoApplication(
  scope: Construct,
  options: ArgoApplicationOptions & { source: ApplicationSpecSource },
): Application {
  const { name, revisionHistoryLimit = DEFAULT_REVISION_HISTORY_LIMIT } =
    options;
  return new Application(scope, options.id ?? `${name}-app`, {
    metadata: { name, ...options.metadata },
    spec: {
      project: applicationProject(name),
      source: options.source,
      destination: { server: IN_CLUSTER_SERVER, namespace: options.namespace },
      ...(revisionHistoryLimit === null ? {} : { revisionHistoryLimit }),
      ...(options.ignoreDifferences === undefined
        ? {}
        : { ignoreDifferences: options.ignoreDifferences }),
      ...(options.syncPolicy === undefined
        ? {}
        : { syncPolicy: options.syncPolicy }),
      ...options.spec,
    },
  });
}

export type HelmApplicationOptions<TChart extends HelmChartName> =
  ArgoApplicationOptions & {
    /** The upstream chart; it selects the type `valuesObject` is checked as. */
    chart: TChart;
    repoUrl: string;
    targetRevision: string;
    valuesObject?: HelmValuesForChart<TChart>;
    /**
     * Values the chart accepts but its generated type cannot express (a key
     * the chart ships commented out, for instance). Rendered as the values
     * object in place of `valuesObject`, unchecked: spread the typed values
     * into it so that only the extra key escapes the type.
     */
    uncheckedValuesObject?: Record<string, unknown>;
    /** Other Helm source settings, such as `releaseName`. */
    helm?: Omit<ApplicationSpecSourceHelm, "valuesObject">;
  };

/**
 * An Application of an upstream Helm chart. The chart name binds the values
 * type, so values written for another chart do not compile.
 */
export function helmApplication<TChart extends HelmChartName>(
  scope: Construct,
  options: HelmApplicationOptions<TChart>,
): Application {
  const {
    chart,
    repoUrl,
    targetRevision,
    valuesObject: typedValues,
    uncheckedValuesObject,
    helm,
    ...common
  } = options;
  if (typedValues !== undefined && uncheckedValuesObject !== undefined) {
    throw new Error(
      `Application ${options.name} sets both valuesObject and uncheckedValuesObject; spread the typed values into the unchecked ones`,
    );
  }
  const valuesObject = typedValues ?? uncheckedValuesObject;
  const helmSource =
    valuesObject === undefined && helm === undefined
      ? {}
      : {
          helm: {
            ...helm,
            ...(valuesObject === undefined ? {} : { valuesObject }),
          },
        };
  return argoApplication(scope, {
    ...common,
    source: { repoUrl, chart, targetRevision, ...helmSource },
  });
}

export type FirstPartyApplicationOptions = ArgoApplicationOptions & {
  /** The wrapper chart. Defaults to the Application's name. */
  chart?: string;
  /** Defaults to the floating first-party revision range. */
  targetRevision?: string;
};

/** An Application of a first-party wrapper chart published to ChartMuseum. */
export function createFirstPartyApplication(
  scope: Construct,
  options: FirstPartyApplicationOptions,
): Application {
  const { chart, targetRevision, ...common } = options;
  return argoApplication(scope, {
    ...common,
    source: {
      repoUrl: FIRST_PARTY_CHART_REPOSITORY,
      chart: chart ?? options.name,
      targetRevision: targetRevision ?? FIRST_PARTY_CHART_REVISION,
    },
  });
}
