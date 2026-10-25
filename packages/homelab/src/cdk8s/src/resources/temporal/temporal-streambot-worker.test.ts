import { expect, test } from "vitest";
import {
  findTemporalResource,
  findTemporalWorkerContainer,
  synthesizeTemporalResources,
} from "@shepherdjerred/homelab/cdk8s/src/temporal-test-resources.ts";
test("the LoL scheduler worker has one credential and only internal Streambot and Temporal access", () => {
  const resources = synthesizeTemporalResources(
    ".test-synth-temporal-streambot-worker",
  );
  const { pod, container } = findTemporalWorkerContainer(
    resources,
    "temporal-temporal-streambot-worker",
  );
  expect(pod.metadata.labels["component"]).toBe("streambot-worker");
  expect(container.env).toContainEqual({
    name: "STREAMBOT_SCHEDULER_TOKEN",
    valueFrom: {
      secretKeyRef: { name: "streambot-scheduler", key: "password" },
    },
  });
  expect(container.env.map((entry) => entry.name)).not.toContain(
    "OPENAI_API_KEY",
  );
  expect(container.env.map((entry) => entry.name)).not.toContain("BOT_TOKEN");
  expect(container.env.map((entry) => entry.name)).not.toContain("USER_TOKENS");
  const otherDeployments = resources.filter(
    (resource) =>
      resource.kind === "Deployment" &&
      resource.metadata.name !== "temporal-temporal-streambot-worker",
  );
  expect(JSON.stringify(otherDeployments)).not.toContain(
    "STREAMBOT_SCHEDULER_TOKEN",
  );
  const policy = findTemporalResource(
    resources,
    "NetworkPolicy",
    "temporal-streambot-worker-netpol",
  );
  const rendered = JSON.stringify(policy);
  expect(rendered).toContain('"port":8081');
  expect(rendered).toContain('"port":7233');
  expect(rendered).toContain('"app":"streambot"');
  expect(rendered).not.toContain('"port":443');
});
