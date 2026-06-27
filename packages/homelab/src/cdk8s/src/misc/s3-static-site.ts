import { Chart, JsonPatch } from "cdk8s";
import { Construct } from "constructs";
import {
  ConfigMap,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  Secret,
  Service,
  Volume,
} from "cdk8s-plus-31";
import { createCloudflareTunnelBinding } from "@shepherdjerred/homelab/cdk8s/src/misc/cloudflare-tunnel.ts";
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
  /**
   * Per-site response-header overrides. Merged on top of `defaultResponseHeaders`
   * (which apply to every site). Set a value to override; set to `null` to delete
   * a default (rendered as `-HeaderName` in the Caddyfile).
   *
   * The merged set is rendered as a single `header { ... }` block at the top of
   * the site, which Caddy applies to all responses — including those proxied
   * through `reverseProxies` upstreams.
   */
  responseHeaders?: Record<string, string | null>;
  /**
   * Path globs whose responses get a long-lived immutable `Cache-Control` so
   * Cloudflare and browsers can cache them indefinitely. ONLY use this for
   * content-hashed (fingerprinted) assets whose filename changes on every
   * rebuild — never for `index.html` or any path that's updated in place, or
   * deploys won't take effect.
   *
   * Defaults to {@link DEFAULT_IMMUTABLE_ASSET_PATHS} (`/_astro/*` — Astro's
   * hashed output dir; harmless on non-Astro sites since the path won't exist).
   * SPA sites override this to add their bundler's hashed dir (e.g. Vite's
   * `/app/assets/*`). Set to `[]` to disable.
   *
   * Caution when a glob overlaps a {@link StaticSiteSpaFallback} prefix (e.g.
   * `/app/assets/*` sits under the `/app/*` SPA fallback): the matcher stamps the
   * immutable `Cache-Control` on *every* matching response by request path —
   * including the 200 `index.html` the fallback serves for a missing key. So the
   * bucket must never prune old content-hashed objects under such a glob, or a
   * request for a deleted asset would cache `index.html` at that asset URL for a
   * year. Content-hashed builds keep every build's output, so this invariant holds
   * in practice.
   *
   * Caching these at the edge is the primary mitigation for intermittent
   * SeaweedFS `SignatureDoesNotMatch` 403s: once cached, repeat visits never
   * hit the origin, so the origin race almost never reaches a user.
   */
  immutableAssetPaths?: string[];
};

/**
 * Defense-in-depth response headers applied to every site. CSP is intentionally
 * NOT here — it's per-app because each app has different image hosts, inline
 * script needs, etc. Sites that need CSP set it via `responseHeaders`.
 *
 * HSTS deliberately uses `max-age=31536000` WITHOUT `includeSubDomains` or
 * `preload` as the default — a misconfigured subdomain could otherwise become
 * permanently unreachable from browsers. Sites that want broader HSTS scope opt
 * in via `responseHeaders`.
 */
export const defaultResponseHeaders: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), interest-cohort=()",
};

/**
 * Default immutable-asset path globs (see `StaticSiteConfig.immutableAssetPaths`).
 * `/_astro/*` is Astro's content-hashed output directory — every site built with
 * Astro emits fingerprinted assets there, and non-Astro sites simply have no such
 * path, so applying this everywhere is safe.
 */
export const DEFAULT_IMMUTABLE_ASSET_PATHS: string[] = ["/_astro/*"];

/**
 * `Cache-Control` value for content-hashed assets. One year + `immutable` is the
 * standard for fingerprinted files: the filename changes on every rebuild, so the
 * cached copy is never stale and revalidation is never needed.
 */
export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

/**
 * Render the `@immutableAssets` matcher + `header` directive that stamps
 * {@link IMMUTABLE_CACHE_CONTROL} onto the given path globs. Returns an empty
 * string when there are no paths (caching disabled for the site).
 *
 * Like the global header block, a `header` directive with a path matcher applies
 * to all matching responses — including those served by the `s3proxy` handler.
 */
export function renderImmutableAssetBlock(paths: string[]): string {
  if (paths.length === 0) return "";
  return `\t@immutableAssets path ${paths.join(" ")}\n\theader @immutableAssets Cache-Control "${IMMUTABLE_CACHE_CONTROL}"`;
}

/**
 * Render the merged-and-per-site Caddyfile `header { ... }` block for one site.
 * Returns an empty string when there are no headers to set (currently never
 * happens because `defaultResponseHeaders` is non-empty).
 *
 * Caddy's `header` directive with an unprefixed name uses Set semantics — it
 * overwrites any upstream-provided value. `null` overrides emit a `-Name`
 * delete directive instead.
 */
export function renderHeaderBlock(
  overrides: Record<string, string | null> | undefined,
): string {
  const merged = new Map<string, string | null>();
  for (const [name, value] of Object.entries(defaultResponseHeaders)) {
    merged.set(name, value);
  }
  for (const [name, value] of Object.entries(overrides ?? {})) {
    merged.set(name, value);
  }

  const lines: string[] = [];
  for (const [name, value] of merged) {
    if (value === null) {
      lines.push(`\t\t-${name}`);
    } else {
      // Caddy requires quoting whenever the value contains spaces or special
      // chars. Always quote to keep the rendering deterministic.
      const escaped = value
        .replaceAll(`\\`, `\\\\`)
        .replaceAll(`"`, String.raw`\"`);
      lines.push(`\t\t${name} "${escaped}"`);
    }
  }
  // Strip Caddy's own Server header so we don't advertise the proxy.
  lines.push(`\t\t-Server`);

  if (lines.length === 0) return "";
  return `\theader {\n${lines.join("\n")}\n\t}`;
}

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
      .map(
        (spa) => `\thandle ${spa.pathPrefix} {
${renderS3Proxy(spa.fallbackPath)}
\t}`,
      )
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
    const immutableBlock = renderImmutableAssetBlock(
      site.immutableAssetPaths ?? DEFAULT_IMMUTABLE_ASSET_PATHS,
    );

    blocks.push(`${address} {
${headerBlock ? `${headerBlock}\n\n` : ""}${immutableBlock ? `${immutableBlock}\n\n` : ""}\t# Redirect directory-style paths to include trailing slash
	# Matches paths like /foo/bar but not /foo/bar/ or /foo/bar.html
${noTrailingSlashMatcher}
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
      // DNS is managed by OpenTofu — operator must not touch DNS records.
      // @tunnel-dns-coverage:hostnames-from ../resources/s3-static-sites/sites.ts
      createCloudflareTunnelBinding(
        this,
        `tunnel-${hostnameSlug(site.hostname)}`,
        {
          serviceName: this.service.name,
          namespace,
          fqdn: site.hostname,
          disableDnsUpdates: true,
        },
      );

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
