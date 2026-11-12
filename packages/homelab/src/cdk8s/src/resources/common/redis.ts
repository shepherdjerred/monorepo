import { Construct } from "constructs";
import type { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import type { HelmValuesForChart } from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";
import { helmApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

export type RedisProps = {
  /**
   * The namespace to deploy Redis into.
   */
  namespace: string;
};

export class Redis extends Construct {
  /**
   * The service name to connect to Redis (e.g., for use in REDIS_HOST env vars).
   */
  public readonly serviceName: string;

  /**
   * The ArgoCD Application resource.
   */
  public readonly application: Application;

  constructor(scope: Construct, id: string, props: RedisProps) {
    super(scope, id);

    const releaseName = id;

    // Bitnami Redis service name format in standalone mode
    this.serviceName = `${releaseName}-master`;

    const redisValues: HelmValuesForChart<"redis"> = {
      architecture: "standalone",
      auth: {
        enabled: false,
      },
      master: {
        persistence: {
          enabled: false,
        },
      },
    };

    this.application = helmApplication(scope, {
      name: id,
      namespace: props.namespace,
      chart: "redis",
      repoUrl: "https://charts.bitnami.com/bitnami",
      targetRevision: versions.redis,
      valuesObject: redisValues,
      helm: {
        releaseName,
      },
      metadata: {
        namespace: "argocd",
      },
      revisionHistoryLimit: null,
      syncPolicy: {
        automated: { enabled: true },
      },
    });
  }
}
