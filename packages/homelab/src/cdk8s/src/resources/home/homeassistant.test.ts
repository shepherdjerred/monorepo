import { describe, expect, test } from "vitest";
import { App, Chart } from "cdk8s";
import { z } from "zod";
import { createHomeAssistantDeployment } from "./homeassistant.ts";

const HomeAssistantPvcSchema = z.object({
  kind: z.literal("PersistentVolumeClaim"),
  metadata: z.object({
    name: z.literal("homeassistant-pvc"),
    labels: z.record(z.string(), z.string()),
  }),
  spec: z.object({
    accessModes: z.array(z.string()),
    storageClassName: z.string(),
    resources: z.object({ requests: z.object({ storage: z.string() }) }),
  }),
});

async function synthesizeHomeAssistantPvc(): Promise<
  z.infer<typeof HomeAssistantPvcSchema>
> {
  const app = new App();
  const chart = new Chart(app, "home", {
    namespace: "home",
    disableResourceNameHashes: true,
  });
  await createHomeAssistantDeployment(chart);
  const manifests = z.array(z.unknown()).parse(chart.toJson());
  const claim = manifests
    .map((manifest) => HomeAssistantPvcSchema.safeParse(manifest))
    .find((result) => result.success)?.data;
  if (claim === undefined) {
    throw new Error("Missing PersistentVolumeClaim/homeassistant-pvc");
  }
  return claim;
}

describe("Home Assistant persistence", () => {
  test("requests the expanded quota without changing storage or backup policy", async () => {
    const claim = await synthesizeHomeAssistantPvc();
    expect(claim.spec.resources.requests.storage).toBe("96Gi");
    expect(claim.spec.storageClassName).toBe("zfs-ssd");
    expect(claim.spec.accessModes).toEqual(["ReadWriteOnce"]);
    expect(claim.metadata.labels).toMatchObject({
      "velero.io/backup": "enabled",
      "velero.io/exclude-from-backup": "false",
    });
  });
});
