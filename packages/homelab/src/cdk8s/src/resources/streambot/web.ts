import { Duration, type Chart } from "cdk8s";
import {
  Probe,
  Service,
  EnvValue,
  type Deployment,
  type Container,
  type ContainerProps,
  type ISecret,
} from "cdk8s-plus-31";

/** Credential bootstrap is deliberate so an unprovisioned OAuth secret cannot break the bot. */
export function streambotWebProbes(): Pick<
  ContainerProps,
  "liveness" | "readiness" | "startup"
> {
  return {
    liveness: Probe.fromHttpGet("/healthz", {
      port: 8080,
      periodSeconds: Duration.seconds(30),
      failureThreshold: 3,
    }),
    readiness: Probe.fromHttpGet("/readyz", {
      port: 8080,
      periodSeconds: Duration.seconds(10),
      failureThreshold: 3,
    }),
    startup: Probe.fromHttpGet("/readyz", {
      port: 8080,
      periodSeconds: Duration.seconds(5),
      failureThreshold: 60,
    }),
  };
}

export function createStreambotWeb(
  chart: Chart,
  deployment: Deployment,
  container: Container,
  bootstrap: { secret: ISecret; publicOrigin: string },
) {
  const { secret, publicOrigin } = bootstrap;
  if (publicOrigin !== "https://streambot.sjer.red")
    throw new Error(
      "Streambot web bootstrap must use its declared public origin",
    );
  container.env.addVariable(
    "WEB_PUBLIC_ORIGIN",
    EnvValue.fromValue(publicOrigin),
  );
  container.env.addVariable("WEB_PORT", EnvValue.fromValue("8080"));
  container.env.addVariable(
    "DISCORD_CLIENT_SECRET",
    EnvValue.fromSecretValue({ secret, key: "DISCORD_CLIENT_SECRET" }),
  );
  container.addPort({ number: 8080, name: "web" });
  new Service(chart, "streambot-web-service", {
    selector: deployment,
    metadata: { name: "streambot-web" },
    ports: [{ name: "web", port: 8080, targetPort: 8080 }],
  });
}
