import { App } from "cdk8s";
import { expect, test } from "vitest";
import { parseAllDocuments } from "yaml";
import { createDdnsChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/ddns.ts";

test("adds an IPv4-only target without taking over the existing DDNS records", () => {
  const app = new App();
  createDdnsChart(app);
  const resources = parseAllDocuments(app.synthYaml()).map((document) =>
    document.toJSON(),
  );
  const deployment = resources.find(
    (resource) => resource.kind === "Deployment",
  );
  const pod = deployment.spec.template.spec;
  expect(pod.containers).toHaveLength(2);
  const [legacy, ipv4] = pod.containers;
  expect(legacy.volumeMounts).toEqual([
    expect.objectContaining({
      mountPath: "/config.json",
      subPath: "config.json",
    }),
  ]);
  expect(legacy.env).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ name: "IP4_DOMAINS" })]),
  );
  expect(ipv4.env).toEqual(
    expect.arrayContaining([
      { name: "IP4_DOMAINS", value: "ipv4.ddns.sjer.red" },
      { name: "IP6_PROVIDER", value: "none" },
      { name: "PROXIED", value: "false" },
    ]),
  );
  expect(ipv4.env.map((entry: { name: string }) => entry.name)).not.toContain(
    "DOMAINS",
  );
  expect(ipv4.image).toBe(legacy.image);
  expect(ipv4.securityContext).toMatchObject({
    runAsNonRoot: true,
    readOnlyRootFilesystem: true,
  });
  const tokenVolume = pod.volumes.find(
    (volume: { name: string }) => volume.name === ipv4.volumeMounts[0].name,
  );
  expect(tokenVolume.secret.items).toEqual([
    { key: "api_token", path: "api-token" },
  ]);
});
