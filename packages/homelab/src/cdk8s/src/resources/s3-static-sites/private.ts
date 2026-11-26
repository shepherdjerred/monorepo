import type { Chart } from "cdk8s";
import {
  Deployment,
  DeploymentStrategy,
  EnvValue,
  Secret,
  Service,
  Volume,
} from "cdk8s-plus-31";
import { tailnetService } from "homelab/src/platform-model.ts";
import { firstPartyImageRecipe } from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import {
  setRevisionHistoryLimit,
  withCommonProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { authenticatedGatewayContainerDefaults } from "@shepherdjerred/homelab/cdk8s/src/misc/authenticated-gateway-container.ts";
import { httpProbes } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/kubelet-probes.ts";
import { seaweedfsS3 } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/runtime-env.ts";
import { renderHeaderBlock } from "@shepherdjerred/homelab/cdk8s/src/misc/static-site-headers.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { S3_CREDENTIALS_SECRET_NAME } from "./sites.ts";

/** The pod label the private gateway's NetworkPolicy selects. */
export const PRIVATE_SHARE_APP_LABELS = {
  app: "s3-static-sites-private",
} as const;

export const PRIVATE_SHARE_PORT = 8080;

/** The namespace's workload that carries the public sites. */
export const PUBLIC_STATIC_SITES_APP_LABELS = {
  app: "s3-static-sites",
} as const;

/**
 * The Caddyfile of the tailnet-only bucket gateway, in the shape of the
 * Temporal UI gateway: read from the environment, one `:8080` site block with
 * no host matching (the Tailscale proxy forwards under the tailnet name), no
 * trailing-slash redirect (keys of shared files have no extension), and
 * `index index.html` for the bucket root. The bucket, region and endpoint are
 * environment placeholders, which Caddy substitutes anywhere in the file.
 */
export function privateShareCaddyfile(): string {
  return `{
	admin off
	auto_https off
	order s3proxy last
}

:${PRIVATE_SHARE_PORT.toString()} {
${renderHeaderBlock(undefined)}

	handle /health {
		respond "ok" 200
	}

	handle {
		s3proxy {
			bucket {$S3_BUCKET}
			region {$S3_REGION}
			index index.html
			endpoint {$S3_ENDPOINT}
			force_path_style
		}
	}
}
`;
}

/**
 * Serves the `private-sjer-red` bucket to the tailnet only: a second Caddy
 * s3proxy beside the public one, behind a Tailscale Ingress and with no
 * Cloudflare tunnel binding or public DNS.
 */
export function createPrivateShareSite(chart: Chart) {
  const deployment = new Deployment(chart, "s3-static-sites-private", {
    replicas: 1,
    strategy: DeploymentStrategy.rollingUpdate(),
    metadata: { name: "s3-static-sites-private" },
    podMetadata: { labels: { ...PRIVATE_SHARE_APP_LABELS } },
  });

  const tmpVolume = Volume.fromEmptyDir(
    chart,
    "s3-static-sites-private-tmp",
    "gateway-tmp",
  );
  const credentials = Secret.fromSecretName(
    chart,
    "s3-static-sites-private-credentials",
    S3_CREDENTIALS_SECRET_NAME,
  );

  deployment.addContainer(
    withCommonProps({
      name: "caddy",
      image: firstPartyImageRecipe("caddy-s3proxy"),
      command: ["/bin/sh", "-c"],
      args: [
        'printf "%s" "$CADDY_CONFIG" > /tmp/Caddyfile && exec caddy run --config /tmp/Caddyfile --adapter caddyfile',
      ],
      ports: [{ name: "http", number: PRIVATE_SHARE_PORT }],
      envVariables: {
        CADDY_CONFIG: EnvValue.fromValue(privateShareCaddyfile()),
        // The literal bucket name: the platform model's consumer rule reads
        // this variable, and the Caddyfile reads it as `{$S3_BUCKET}`.
        ...seaweedfsS3.bucketEnv("S3_BUCKET", "s3-static-sites"),
        S3_ENDPOINT: EnvValue.fromValue(seaweedfsS3.endpoint),
        S3_REGION: EnvValue.fromValue(seaweedfsS3.region),
        ...seaweedfsS3.credentialsEnv(credentials),
      },
      volumeMounts: [{ path: "/tmp", volume: tmpVolume }],
      ...authenticatedGatewayContainerDefaults(),
      ...httpProbes(PRIVATE_SHARE_PORT, { live: "/health", ready: "/health" }),
    }),
  );
  setRevisionHistoryLimit(deployment);

  const service = new Service(chart, "s3-static-sites-private-service", {
    metadata: {
      name: "s3-static-sites-private",
      labels: { ...PRIVATE_SHARE_APP_LABELS },
    },
    selector: deployment,
    ports: [{ name: "http", port: 80, targetPort: PRIVATE_SHARE_PORT }],
  });

  new TailscaleIngress(chart, "s3-static-sites-private-tailscale", {
    service,
    host: tailnetService("private"),
    probePath: "/health",
  });

  return { deployment, service };
}
