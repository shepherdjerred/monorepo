import { firstPartyImageRecipe } from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { Chart, JsonPatch } from "cdk8s";
import { Construct } from "constructs";
import {
  platformModel,
  type PublicHostname,
} from "homelab/src/platform-model.ts";
import {
  Capability,
  ConfigMap,
  Deployment,
  DeploymentStrategy,
  Probe as KubeletProbe,
  Secret,
  Service,
  Volume,
} from "cdk8s-plus-31";
import { createCloudflareTunnelBinding } from "@shepherdjerred/homelab/cdk8s/src/misc/cloudflare-tunnel.ts";
import { createServiceMonitor } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/service-monitor.ts";
import { withCommonProps } from "./common.ts";
import { ApiObject } from "cdk8s";
import { Probe } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com.ts";
import {
  mailPolicyText,
  type MailPolicy,
} from "homelab/src/domain-registry.ts";
import { seaweedfsS3 } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/runtime-env.ts";
import {
  renderHeaderBlock,
  renderHeaderValues,
} from "./static-site-headers.ts";

export type MailPolicyHost = {
  hostname: string;
  policy: MailPolicy;
};

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
 * Ordering: `generateCaddyfile` sorts entries by `path` length descending so
 * longer/narrower paths (e.g. `/api/healthz`) emit before broader prefixes
 * (e.g. `/api/*`) that would otherwise shadow them in `handle` matching order.
 */
export type StaticSiteReverseProxy = {
  path: string;
  upstream: string;
  rewriteTo?: string;
};

/**
 * SPA-style fallback for client-side routing. Extensionless paths under
 * `pathPrefix` are rewritten to `fallbackPath` before the bucket lookup so
 * successful document responses retain HTTP 200. Missing assets still 404.
 *
 * Without this, deep links like `/app/g/123/audit` (handled client-side by
 * React Router) would 404 on hard-refresh because the bucket has no object
 * at that key.
 */
export type StaticSiteSpaFallback = {
  pathPrefix: string;
  fallbackPath: string;
  /** Headers applied only inside this routed prefix. */
  responseHeaders?: Record<string, string | null>;
};

/**
 * Another hostname that serves a site's bucket, with the site's headers,
 * proxies and fallbacks. `rootPath` is the bucket directory its `/` serves, so
 * a page deep in the bucket can be the alias's front page with HTTP 200 and no
 * redirect. Every other path is the bucket's own, which is how the page's
 * root-relative assets resolve on the alias.
 */
export type StaticSiteAlias = {
  hostname: string;
  rootPath?: `/${string}/`;
};

export type StaticSiteConfig = {
  hostname: string;
  bucket: string;
  aliases?: StaticSiteAlias[];
  indexFile?: string;
  notFoundPage?: string;
  probes?: StaticSiteProbeConfig[];
  reverseProxies?: StaticSiteReverseProxy[];
  spaFallbacks?: StaticSiteSpaFallback[];
  /**
   * Per-site response-header overrides. Merged on top of `defaultResponseHeaders`
   * in `static-site-headers.ts` (which apply to every site). Set a value to override; set to `null` to delete
   * a default (rendered as `-HeaderName` in the Caddyfile).
   *
   * The merged set is rendered as a single `header { ... }` block at the top of
   * the site, which Caddy applies to all responses — including those proxied
   * through `reverseProxies` upstreams.
   */
  responseHeaders?: Record<string, string | null>;
};

export type S3StaticSitesProps = {
  sites: StaticSiteConfig[];
  mailPolicies?: MailPolicyHost[];
  s3Endpoint: string;
  s3Region?: string;
  credentialsSecretName: string;
};

export type CaddyfileGeneratorProps = {
  sites: StaticSiteConfig[];
  mailPolicies?: MailPolicyHost[];
  s3Endpoint: string;
  s3Region?: string;
};

export const STATIC_SITE_HTTP_PORT = 8080;
export const STATIC_SITE_METRICS_PORT = 9180;

/** The tunnel route of a host this origin serves: the model's static-site origin. */
function originRoute(hostname: string): PublicHostname {
  return { hostname, ...platformModel.staticSiteOrigin };
}

/** A hostname the origin answers on: a site's own, or one of its aliases. */
type ServedHost = {
  site: StaticSiteConfig;
  hostname: string;
  rootPath: string | undefined;
  alias: boolean;
};

function servedHosts(site: StaticSiteConfig): ServedHost[] {
  return [
    { site, hostname: site.hostname, rootPath: undefined, alias: false },
    ...(site.aliases ?? []).map((alias) => ({
      site,
      hostname: alias.hostname,
      rootPath: alias.rootPath,
      alias: true,
    })),
  ];
}

/**
 * Generates a Caddyfile for S3 static sites.
 * Exported for testing/validation purposes.
 */
export function generateCaddyfile(props: CaddyfileGeneratorProps): string {
  const blocks: string[] = [];

  blocks.push(`{
	order s3proxy last
	auto_https off
	http_port ${STATIC_SITE_HTTP_PORT.toString()}
	metrics
}

:${STATIC_SITE_METRICS_PORT.toString()} {
	metrics /metrics
}
`);

  for (const { site, hostname, rootPath } of props.sites.flatMap((entry) =>
    servedHosts(entry),
  )) {
    const indexFile = site.indexFile ?? "index.html";
    const notFoundPage = site.notFoundPage ?? "404.html";
    const address = hostname.includes("://") ? hostname : `http://${hostname}`;

    // `handle` blocks evaluate in registration order, not by specificity.
    // Sort by literal path length descending so longer/narrower paths
    // (e.g. `/api/healthz`, 12 chars) emit before broader prefixes
    // (e.g. `/api/*`, 6 chars) that would otherwise shadow them.
    const proxies = (site.reverseProxies ?? []).toSorted(
      (a, b) => b.path.length - a.path.length,
    );
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
      .map((spa) => {
        const routeHeaders = renderHeaderValues(
          new Map(Object.entries(spa.responseHeaders ?? {})),
          2,
          false,
        );
        return `\thandle ${spa.pathPrefix} {
${routeHeaders ? `${routeHeaders}\n` : ""}\t\t@spaDocument {
\t\t\tnot path_regexp \\.[^/]+$
\t\t}
\t\trewrite @spaDocument ${spa.fallbackPath}
${renderS3Proxy(spa.fallbackPath)}
\t}`;
      })
      .join("\n\n");

    // Caddy's `redir` directive has a lower ordinal than `handle`, so without
    // an exclusion the trailing-slash redirect would 301 paths like
    // `/api/healthz` to `/api/healthz/` BEFORE any `handle` block fires —
    // shadowing the proxy rewrite and breaking blackbox probes. Exclude every
    // path owned by a `handle` block from the redirect matcher.
    const exclusionPaths = [
      ...proxies.map((p) => p.path),
      ...(site.spaFallbacks ?? []).map((s) => s.pathPrefix),
    ];
    const noTrailingSlashMatcher =
      exclusionPaths.length === 0
        ? `\t@noTrailingSlash path_regexp ^/[^.]*[^/]$`
        : `\t@noTrailingSlash {
\t\tpath_regexp ^/[^.]*[^/]$
\t\tnot path ${exclusionPaths.join(" ")}
\t}`;

    const headerBlock = renderHeaderBlock(site.responseHeaders);

    // `rewrite` runs after `redir` and before `handle`, and `/` matches only
    // the root, so the bucket lookup sees `rootPath` while the visitor keeps
    // the alias's own address and query string.
    const rootRewrite =
      rootPath === undefined
        ? ""
        : `\n\t# Serve ${rootPath} at the root of this hostname, without a redirect\n\trewrite / ${rootPath}\n`;

    blocks.push(`${address} {
${headerBlock ? `${headerBlock}\n\n` : ""}\t# Redirect directory-style paths to include trailing slash
	# Matches paths like /foo/bar but not /foo/bar/ or /foo/bar.html
${noTrailingSlashMatcher}
	redir @noTrailingSlash {uri}/ 301
${rootRewrite}${proxyBlocks ? `\n${proxyBlocks}\n` : ""}${spaBlocks ? `\n${spaBlocks}\n` : ""}
	handle {
${renderS3Proxy(notFoundPage)}
	}
}
`);
  }

  for (const host of props.mailPolicies ?? []) {
    const policy = mailPolicyText(host.policy);
    blocks.push(`http://${host.hostname} {
\theader {
\t\tContent-Type "text/plain; charset=utf-8"
\t\tCache-Control "no-store"
\t\tX-Content-Type-Options "nosniff"
\t\t-Server
\t}
\thandle /.well-known/mta-sts.txt {
\t\trespond \`${policy}\` 200
\t}
\thandle {
\t\trespond "Not found" 404
\t}
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

/**
 * An alias exists to answer at its own address, so its one probe fails on a
 * redirect. The paths behind it are the site's, which the site's probes cover.
 */
const ALIAS_PROBES: Required<StaticSiteProbeConfig>[] = [
  { endpoint: "root", path: "/", module: "http_200_no_redirect" },
];

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
    const caddyfileHash = new Bun.CryptoHasher("sha256")
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
        // Deliberately BestEffort (no requests/limits) — negligible or
        // non-critical usage; see the 2026-06-12 right-sizing plan.
        resources: {},
        name: "caddy",
        image: firstPartyImageRecipe("caddy-s3proxy"),
        ports: [
          { number: STATIC_SITE_HTTP_PORT },
          { name: "metrics", number: STATIC_SITE_METRICS_PORT },
        ],
        startup: KubeletProbe.fromTcpSocket({
          port: STATIC_SITE_HTTP_PORT,
          failureThreshold: 3,
        }),
        envVariables: {
          ...seaweedfsS3.credentialsEnv(credentialsSecret),
        },
        securityContext: {
          readOnlyRootFilesystem: false,
          user: 1000,
          group: 1000,
          capabilities: {
            drop: [Capability.ALL],
          },
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

    const serviceLabels = { app: "s3-static-sites" };
    this.service = new Service(this, "service", {
      metadata: {
        name: "s3-static-sites",
        labels: serviceLabels,
      },
      selector: deployment,
      ports: [
        { name: "http", port: 80, targetPort: STATIC_SITE_HTTP_PORT },
        {
          name: "metrics",
          port: STATIC_SITE_METRICS_PORT,
          targetPort: STATIC_SITE_METRICS_PORT,
        },
      ],
    });

    createServiceMonitor(chart, {
      name: "s3-static-sites",
      namespace,
      matchLabels: serviceLabels,
    });

    for (const host of props.mailPolicies ?? []) {
      // Each policy has a body-aware public Probe below; the backend health is
      // already covered by the static-site fleet served by this same Caddy.
      createCloudflareTunnelBinding(
        this,
        `tunnel-${hostnameSlug(host.hostname)}`,
        {
          serviceName: this.service.name,
          namespace,
          hostname: originRoute(host.hostname),
          disableDnsUpdates: true,
          disableProbe: true,
          port: 80,
        },
      );

      new Probe(this, `probe-${hostnameSlug(host.hostname)}`, {
        metadata: {
          name: `static-site-${hostnameSlug(host.hostname)}`,
          namespace,
          labels: { release: "prometheus" },
        },
        spec: {
          jobName: `static-site-${host.hostname}`,
          interval: "60s",
          module: "mta_sts_policy",
          prober: {
            url: "prometheus-prometheus-blackbox-exporter.prometheus:9115",
          },
          targets: {
            staticConfig: {
              static: [`https://${host.hostname}/.well-known/mta-sts.txt`],
              labels: {
                endpoint: "mta-sts",
                path: "/.well-known/mta-sts.txt",
                site: host.hostname,
              },
            },
          },
        },
      });
    }

    for (const { site, hostname, alias } of props.sites.flatMap((entry) =>
      servedHosts(entry),
    )) {
      // DNS is managed by OpenTofu — operator must not touch DNS records.
      createCloudflareTunnelBinding(this, `tunnel-${hostnameSlug(hostname)}`, {
        serviceName: this.service.name,
        namespace,
        hostname: originRoute(hostname),
        disableDnsUpdates: true,
        port: 80,
        // Static sites already get bespoke Probe coverage below (per-site,
        // per-endpoint, with SSL-expiry and slow-response checks) — the
        // generic auto-registered probe would just be a redundant duplicate.
        disableProbe: true,
      });

      for (const probe of alias ? ALIAS_PROBES : probeConfigs(site)) {
        const nameSuffix =
          probe.endpoint === "root"
            ? hostnameSlug(hostname)
            : `${hostnameSlug(hostname)}-${probe.endpoint}`;

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
                ? `static-site-${hostname}`
                : `static-site-${hostname}-${probe.endpoint}`,
            interval: "60s",
            module: probe.module,
            prober: {
              url: "prometheus-prometheus-blackbox-exporter.prometheus:9115",
            },
            targets: {
              staticConfig: {
                static: [probeTargetUrl(hostname, probe.path)],
                labels: {
                  endpoint: probe.endpoint,
                  path: probe.path,
                  site: hostname,
                },
              },
            },
          },
        });
      }
    }
  }
}
