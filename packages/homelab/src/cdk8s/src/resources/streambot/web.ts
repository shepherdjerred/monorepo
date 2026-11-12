import { type Chart } from "cdk8s";
import {
  Service,
  EnvValue,
  type Deployment,
  type ContainerPort,
  type ContainerProps,
  type ISecret,
} from "cdk8s-plus-31";
import { httpProbes } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/kubelet-probes.ts";

export const STREAMBOT_WEB_PUBLIC_ORIGIN = "https://streambot.sjer.red";

/** Credential bootstrap is deliberate so an unprovisioned OAuth secret cannot break the bot. */
export function streambotWebProbes(): Pick<
  ContainerProps,
  "liveness" | "readiness" | "startup"
> {
  return {
    ...httpProbes(8080, {
      live: "/healthz",
      ready: "/readyz",
      startup: { failureThreshold: 60, path: "/readyz" },
    }),
  };
}

/** Creates the web Service; returns what the streambot container adds for it. */
export function createStreambotWeb(
  chart: Chart,
  deployment: Deployment,
  bootstrap: { secret: ISecret; publicOrigin: string },
): { envVariables: Record<string, EnvValue>; ports: ContainerPort[] } {
  const { secret, publicOrigin } = bootstrap;
  if (publicOrigin !== STREAMBOT_WEB_PUBLIC_ORIGIN)
    throw new Error(
      "Streambot web bootstrap must use its declared public origin",
    );
  new Service(chart, "streambot-web-service", {
    selector: deployment,
    metadata: { name: "streambot-web" },
    ports: [{ name: "web", port: 8080, targetPort: 8080 }],
  });
  return {
    envVariables: {
      WEB_PUBLIC_ORIGIN: EnvValue.fromValue(publicOrigin),
      WEB_PORT: EnvValue.fromValue("8080"),
      DISCORD_CLIENT_SECRET: EnvValue.fromSecretValue({
        secret,
        key: "DISCORD_CLIENT_SECRET",
      }),
    },
    ports: [{ number: 8080, name: "web" }],
  };
}
