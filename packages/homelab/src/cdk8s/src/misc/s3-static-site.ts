import { Chart, JsonPatch } from "cdk8s";
import { Construct } from "constructs";
import { ConfigMap, Deployment, DeploymentStrategy, EnvValue, Secret, Service, Volume } from "cdk8s-plus-31";
import { TunnelBinding, TunnelBindingTunnelRefKind } from "../../generated/imports/networking.cfargotunnel.com.ts";
import { withCommonProps } from "./common.ts";
import versions from "../versions.ts";
import { ApiObject } from "cdk8s";
import { Probe } from "../../generated/imports/monitoring.coreos.com.ts";

export type StaticSiteConfig = {
  hostname: string;
  bucket: string;
  indexFile?: string;
  notFoundPage?: string;
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
    const address = site.hostname.includes("://") ? site.hostname : `http://${site.hostname}`;

    blocks.push(`${address} {
	# Redirect directory-style paths to include trailing slash
	# Matches paths like /foo/bar but not /foo/bar/ or /foo/bar.html
	@noTrailingSlash path_regexp ^/[^.]*[^/]$
	redir @noTrailingSlash {uri}/ 301

	# Strip conditional headers to work around caddy-s3-proxy issue #63
	# https://github.com/lindenlab/caddy-s3-proxy/issues/63
	request_header -If-Modified-Since
	request_header -If-None-Match

	s3proxy {
		bucket ${site.bucket}
		region {$S3_REGION:${props.s3Region ?? "us-east-1"}}
		index ${indexFile}
		errors 404 ${notFoundPage}
		endpoint {$S3_ENDPOINT:${props.s3Endpoint}}
		force_path_style
	}
}
`);
  }

  return blocks.join("\n");
}

export class S3StaticSites extends Construct {
  public readonly service: Service;
  public readonly deployment: Deployment;

  constructor(scope: Construct, id: string, props: S3StaticSitesProps) {
    super(scope, id);

    const chart = Chart.of(this);
    const namespace = chart.namespace;

    const caddyfile = generateCaddyfile(props);

    const configMap = new ConfigMap(this, "caddyfile", {
      metadata: {
        name: "s3-static-sites-caddyfile",
      },
      data: {
        Caddyfile: caddyfile,
      },
    });

    const caddyfileVolume = Volume.fromConfigMap(this, "caddyfile-volume", configMap, {
      name: "caddyfile",
      items: {
        Caddyfile: { path: "Caddyfile" },
      },
    });

    const deployment = new Deployment(this, "deployment", {
      replicas: 1,
      strategy: DeploymentStrategy.rollingUpdate(),
      metadata: {
        name: "s3-static-sites",
        annotations: {
          "ignore-check.kube-linter.io/no-read-only-root-fs": "Caddy requires writable filesystem for runtime data",
        },
      },
    });

    const dataVolume = Volume.fromEmptyDir(this, "caddy-data", "caddy-data");
    const configVolume = Volume.fromEmptyDir(this, "caddy-config", "caddy-config");

    const credentialsSecret = Secret.fromSecretName(chart, "s3-credentials-secret", props.credentialsSecretName);

    const container = deployment.addContainer(
      withCommonProps({
        name: "caddy",
        image: `ghcr.io/shepherdjerred/caddy-s3proxy:${versions["shepherdjerred/caddy-s3proxy"]}`,
        portNumber: 80,
        envVariables: {
          AWS_ACCESS_KEY_ID: EnvValue.fromSecretValue({
            secret: credentialsSecret,
            key: "access_key",
          }),
          AWS_SECRET_ACCESS_KEY: EnvValue.fromSecretValue({
            secret: credentialsSecret,
            key: "secret_key",
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

    const envFromPatch = JsonPatch.add("/spec/template/spec/containers/0/envFrom", [
      {
        secretRef: {
          name: props.credentialsSecretName,
        },
      },
    ]);
    ApiObject.of(deployment).addJsonPatch(envFromPatch);

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
      new TunnelBinding(this, `tunnel-${site.hostname.replace(/\./g, "-")}`, {
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

      // Create Probe for HTTP monitoring via blackbox-exporter
      new Probe(this, `probe-${site.hostname.replace(/\./g, "-")}`, {
        metadata: {
          name: `static-site-${site.hostname.replace(/\./g, "-")}`,
          namespace,
          labels: { release: "prometheus" },
        },
        spec: {
          jobName: `static-site-${site.hostname}`,
          interval: "60s",
          module: "http_2xx",
          prober: {
            url: "prometheus-prometheus-blackbox-exporter.prometheus:9115",
          },
          targets: {
            staticConfig: {
              static: [`https://${site.hostname}`],
              labels: {
                site: site.hostname,
              },
            },
          },
        },
      });
    }
  }
}
