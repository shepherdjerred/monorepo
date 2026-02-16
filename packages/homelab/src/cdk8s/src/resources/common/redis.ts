import { Construct } from "constructs";
import { Application } from "../../../generated/imports/argoproj.io.ts";
import versions from "../../versions.ts";
import type { HelmValuesForChart } from "../../misc/typed-helm-parameters.ts";

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

    this.application = new Application(scope, `${id}-app`, {
      metadata: {
        name: id,
        namespace: "argocd",
      },
      spec: {
        project: "default",
        source: {
          repoUrl: "https://charts.bitnami.com/bitnami",
          targetRevision: versions.redis,
          chart: "redis",
          helm: {
            releaseName: releaseName,
            valuesObject: redisValues,
          },
        },
        destination: {
          server: "https://kubernetes.default.svc",
          namespace: props.namespace,
        },
        syncPolicy: {
          automated: {},
        },
      },
    });
  }
}
