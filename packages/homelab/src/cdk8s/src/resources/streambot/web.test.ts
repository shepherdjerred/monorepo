import { describe, expect, it } from "vitest";
import { App, Chart } from "cdk8s";
import { Deployment, Secret } from "cdk8s-plus-31";
import {
  createStreambotWeb,
  streambotWebProbes,
} from "@shepherdjerred/homelab/cdk8s/src/resources/streambot/web.ts";

describe("Streambot web credential bootstrap", () => {
  it("requires OAuth credentials and prepares an internal web service without publishing a tunnel", () => {
    const app = new App();
    const chart = new Chart(app, "streambot-web-test", { namespace: "media" });
    const deployment = new Deployment(chart, "streambot", { replicas: 1 });
    const container = deployment.addContainer({
      name: "streambot",
      image: "streambot:fixture",
      ...streambotWebProbes(),
    });
    const secret = Secret.fromSecretName(
      chart,
      "secret",
      "media-streambot-config",
    );
    createStreambotWeb(chart, deployment, container, {
      secret,
      publicOrigin: "https://streambot.sjer.red",
    });
    const yaml = app.synthYaml();
    expect(yaml).toContain("streambot.sjer.red");
    expect(yaml).not.toContain("kind: TunnelBinding");
    expect(yaml).toContain("name: streambot-web");
    expect(yaml).toContain("port: 8080");
    expect(yaml).toContain("key: DISCORD_CLIENT_SECRET");
    expect(yaml).not.toContain("optional: true");
    expect(yaml).toContain("path: /readyz");
    expect(yaml).toContain("path: /healthz");
    expect(yaml).not.toContain("9466");
  });
});
