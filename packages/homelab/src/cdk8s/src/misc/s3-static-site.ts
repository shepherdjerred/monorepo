import { Chart, JsonPatch } from "cdk8s";
import { Construct } from "constructs";
import { createHash } from "node:crypto";
import {
  ConfigMap,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  Secret,
  Service,
  Volume,
} from "cdk8s-plus-31";
import {
  TunnelBinding,
  TunnelBindingTunnelRefKind,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/networking.cfargotunnel.com.ts";
import { withCommonProps } from "./common.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { ApiObject } from "cdk8s";
import { Probe } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com.ts";

export type StaticSiteProbeConfig = {
  endpoint: string;
  path: `/${string}`;
  module?: string;
};

/**
 * Caddy reverse-proxy rule for a site. Used to route specific paths to an
 * in-cluster backend instead of falling through to the s3proxy bucket.
 *
 * When `rewriteTo` is set, Caddy rewrites the request path to that value
 * before proxying — e.g. publicly exposing `/api/healthz` while the backend
 * only serves `/healthz`.
 *
 * Ordering note: `generateCaddyfile` sorts entries with `rewriteTo` first so
 * more-specific paths (typically health endpoints) emit before broader
 * prefixes that would otherwise shadow them in `handle` matching order.
 */
export type StaticSiteReverseProxy = {
  path: string;
  upstream: string;
  rewriteTo?: string;
};

/**
 * SPA-style fallback for client-side routing. When requests under
 * `pathPrefix` would 404 against the bucket, serve `fallbackPath` instead so
 * the SPA's router can handle the URL.
 *
 * Without this, deep links like `/app/g/123/audit` (handled client-side by
 * React Router) would 404 on hard-refresh because the bucket has no object
 * at that key.
 */
export type StaticSiteSpaFallback = {
  pathPrefix: string;
  fallbackPath: string;
};

export type StaticSiteConfig = {
  hostname: string;
  bucket: string;
  indexFile?: string;
  notFoundPage?: string;
  probes?: StaticSiteProbeConfig[];
  reverseProxies?: StaticSiteReverseProxy[];
  spaFallbacks?: StaticSiteSpaFallback[];
};

export type S3StaticSitesProps = {
  sites: StaticSiteConfig[];
  s3Endpoint: string;
  s3Region?: string;
  credentialsSecretName: string;
};

export type CaddyfileGeneratorProps = {
  sites: StaticSiteConfig[];
  s3Endpoint: string;
  s3Region?: string;
};

/**
 * Generates a Caddyfile for S3 static sites.
 * Exported for testing/validation purposes.
 */
export function generateCaddyfile(props: CaddyfileGeneratorProps): string {
  const blocks: string[] = [];

  blocks.push(`{
	order s3proxy last
	auto_https off
}
`);

  for (const site of props.sites) {
    const indexFile = site.indexFile ?? "index.html";
    const notFoundPage = site.notFoundPage ?? "404.html";
    const address = site.hostname.includes("://")
      ? site.hostname
      : `http://${site.hostname}`;

    // `handle` blocks evaluate in registration order, not by specificity.
    // Entries with `rewriteTo` are typically narrow paths (e.g.
    // `/api/healthz`) that must emit before a broader prefix (e.g. `/api/*`)
    // that would otherwise shadow them.
    const proxies = (site.reverseProxies ?? []).toSorted((a, b) => {
      const aSpecific = a.rewriteTo === undefined ? 1 : 0;
      const bSpecific = b.rewriteTo === undefined ? 1 : 0;
      return aSpecific - bSpecific;
    });
    const proxyBlocks = proxies
      .map((proxy) => {
        const rewriteLine =
          proxy.rewriteTo === undefined
            ? ""
            : `\t\trewrite * ${proxy.rewriteTo}\n`;
        return `\thandle ${proxy.path} {
${rewriteLine}\t\treverse_proxy ${proxy.upstream} {
\t\t\tlb_policy round_robin
\t\t\tlb_try_duration 5s
\t\t}
\t}`;
      })
      .join("\n\n");

    const region = `{$S3_REGION:${props.s3Region ?? "us-east-1"}}`;
    const endpoint = `{$S3_ENDPOINT:${props.s3Endpoint}}`;
    const renderS3Proxy = (notFound: string): string => `\t\ts3proxy {
\t\t\tbucket ${site.bucket}
\t\t\tregion ${region}
\t\t\tindex ${indexFile}
\t\t\terrors 404 ${notFound}
\t\t\tendpoint ${endpoint}
\t\t\tforce_path_style
\t\t}`;

    const spaBlocks = (site.spaFallbacks ?? [])
      .map(
        (spa) => `\thandle ${spa.pathPrefix} {
${renderS3Proxy(spa.fallbackPath)}
\t}`,
      )
      .join("\n\n");

    blocks.push(`${address} {
	# Redirect directory-style paths to include trailing slash
	# Matches paths like /foo/bar but not /foo/bar/ or /foo/bar.html
	@noTrailingSlash path_regexp ^/[^.]*[^/]$
	redir @noTrailingSlash {uri}/ 301
${proxyBlocks ? `\n${proxyBlocks}\n` : ""}${spaBlocks ? `\n${spaBlocks}\n` : ""}
	handle {
${renderS3Proxy(notFoundPage)}
	}
}
`);
  }

  return blocks.join("\n");
}

function hostnameSlug(hostname: string): string {
  return hostname.replaceAll(".", "-");
}

function probeTargetUrl(hostname: string, path: `/${string}`): string {
  return `https://${hostname}${path === "/" ? "" : path}`;
}

function probeConfigs(
  site: StaticSiteConfig,
): Required<StaticSiteProbeConfig>[] {
  const configs: Required<StaticSiteProbeConfig>[] = [
    { endpoint: "root", path: "/", module: "http_2xx" },
    ...(site.probes ?? []).map((probe) => ({
      endpoint: probe.endpoint,
      path: probe.path,
      module: probe.module ?? "http_2xx",
    })),
  ];

  // `endpoint` becomes part of the Probe construct ID and metadata name; a
  // collision would make cdk8s synth fail with a hard-to-trace duplicate-id
  // error. Surface it here with the offending site for fast debugging. The
  // "root" endpoint is reserved for the implicit homepage probe above, so
  // user-provided probes cannot reuse that name.
  const seen = new Set<string>();
  for (const probe of configs) {
    if (seen.has(probe.endpoint)) {
      throw new Error(
        `Duplicate probe endpoint '${probe.endpoint}' for site '${site.hostname}' — endpoints must be unique, and 'root' is reserved for the homepage probe.`,
      );
    }
    seen.add(probe.endpoint);
  }

  return configs;
}

export class S3StaticSites extends Construct {
  public readonly service: Service;
  public readonly deployment: Deployment;

  constructor(scope: Construct, id: string, props: S3StaticSitesProps) {
    super(scope, id);

    const chart = Chart.of(this);
    const namespace = chart.namespace;

    const caddyfile = generateCaddyfile(props);
    // Pod-template annotation so ConfigMap changes trigger a rollout. K8s
    // propagates ConfigMap volume updates, but Caddy won't re-read its
    // Caddyfile without a SIGUSR1 or pod restart, and the cluster doesn't
    // run a config-reloader controller.
    const caddyfileHash = createHash("sha256")
      .update(caddyfile)
      .digest("hex")
      .slice(0, 12);

    const configMap = new ConfigMap(this, "caddyfile", {
      metadata: {
        name: "s3-static-sites-caddyfile",
      },
      data: {
        Caddyfile: caddyfile,
      },
    });

    const caddyfileVolume = Volume.fromConfigMap(
      this,
      "caddyfile-volume",
      configMap,
      {
        name: "caddyfile",
        items: {
          Caddyfile: { path: "Caddyfile" },
        },
      },
    );

    const deployment = new Deployment(this, "deployment", {
      replicas: 1,
      strategy: DeploymentStrategy.rollingUpdate(),
      metadata: {
        name: "s3-static-sites",
        annotations: {
          "ignore-check.kube-linter.io/no-read-only-root-fs":
            "Caddy requires writable filesystem for runtime data",
        },
      },
    });

    const dataVolume = Volume.fromEmptyDir(this, "caddy-data", "caddy-data");
    const configVolume = Volume.fromEmptyDir(
      this,
      "caddy-config",
      "caddy-config",
    );

    const credentialsSecret = Secret.fromSecretName(
      chart,
      "s3-credentials-secret",
      props.credentialsSecretName,
    );

    const container = deployment.addContainer(
      withCommonProps({
        name: "caddy",
        image: `ghcr.io/shepherdjerred/caddy-s3proxy:${versions["shepherdjerred/caddy-s3proxy"]}`,
        portNumber: 80,
        envVariables: {
          AWS_ACCESS_KEY_ID: EnvValue.fromSecretValue({
            secret: credentialsSecret,
            key: "SEAWEEDFS_ACCESS_KEY_ID",
          }),
          AWS_SECRET_ACCESS_KEY: EnvValue.fromSecretValue({
            secret: credentialsSecret,
            key: "SEAWEEDFS_SECRET_ACCESS_KEY",
          }),
        },
        securityContext: {
          readOnlyRootFilesystem: false,
          user: 1000,
          group: 1000,
        },
      }),
    );

    container.mount("/etc/caddy", caddyfileVolume);
    container.mount("/data", dataVolume);
    container.mount("/config", configVolume);

    const envFromPatch = JsonPatch.add(
      "/spec/template/spec/containers/0/envFrom",
      [
        {
          secretRef: {
            name: props.credentialsSecretName,
          },
        },
      ],
    );
    ApiObject.of(deployment).addJsonPatch(envFromPatch);

    deployment.podMetadata.addAnnotation("caddyfile-hash", caddyfileHash);

    this.deployment = deployment;

    this.service = new Service(this, "service", {
      metadata: {
        name: "s3-static-sites",
      },
      selector: deployment,
      ports: [{ port: 80 }],
    });

    for (const site of props.sites) {
      // DNS is managed by OpenTofu — disable cloudflare-operator DNS updates
      new TunnelBinding(this, `tunnel-${hostnameSlug(site.hostname)}`, {
        metadata: {
          namespace,
        },
        subjects: [
          {
            name: this.service.name,
            spec: {
              fqdn: site.hostname,
            },
          },
        ],
        tunnelRef: {
          kind: TunnelBindingTunnelRefKind.CLUSTER_TUNNEL,
          name: "homelab-tunnel",
          disableDnsUpdates: true,
        },
      });

      for (const probe of probeConfigs(site)) {
        const nameSuffix =
          probe.endpoint === "root"
            ? hostnameSlug(site.hostname)
            : `${hostnameSlug(site.hostname)}-${probe.endpoint}`;

        // Create Probe for HTTP monitoring via blackbox-exporter
        new Probe(this, `probe-${nameSuffix}`, {
          metadata: {
            name: `static-site-${nameSuffix}`,
            namespace,
            labels: { release: "prometheus" },
          },
          spec: {
            jobName:
              probe.endpoint === "root"
                ? `static-site-${site.hostname}`
                : `static-site-${site.hostname}-${probe.endpoint}`,
            interval: "60s",
            module: probe.module,
            prober: {
              url: "prometheus-prometheus-blackbox-exporter.prometheus:9115",
            },
            targets: {
              staticConfig: {
                static: [probeTargetUrl(site.hostname, probe.path)],
                labels: {
                  endpoint: probe.endpoint,
                  path: probe.path,
                  site: site.hostname,
                },
              },
            },
          },
        });
      }
    }
  }
}
