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

async function synthesizeHomeAssistant(): Promise<unknown[]> {
  const app = new App();
  const chart = new Chart(app, "home", {
    namespace: "home",
    disableResourceNameHashes: true,
  });
  await createHomeAssistantDeployment(chart);
  return z.array(z.unknown()).parse(chart.toJson());
}

function findManifest<T extends z.ZodType>(
  manifests: unknown[],
  schema: T,
  description: string,
): z.infer<T> {
  for (const manifest of manifests) {
    const result = schema.safeParse(manifest);
    if (result.success) {
      return result.data;
    }
  }
  throw new Error(`Missing ${description}`);
}

describe("Home Assistant persistence", () => {
  test("requests the expanded quota without changing storage or backup policy", async () => {
    const claim = findManifest(
      await synthesizeHomeAssistant(),
      HomeAssistantPvcSchema,
      "PersistentVolumeClaim/homeassistant-pvc",
    );
    expect(claim.spec.resources.requests.storage).toBe("96Gi");
    expect(claim.spec.storageClassName).toBe("zfs-ssd");
    expect(claim.spec.accessModes).toEqual(["ReadWriteOnce"]);
    expect(claim.metadata.labels).toMatchObject({
      "velero.io/backup": "enabled",
      "velero.io/exclude-from-backup": "false",
    });
  });
});

// Only the mounts are parsed; stability is asserted on the whole rendering.
const MountedContainerSchema = z.object({
  volumeMounts: z.array(
    z.object({ mountPath: z.string(), subPath: z.string().optional() }),
  ),
});
const HomeAssistantDeploymentSchema = z.object({
  kind: z.literal("Deployment"),
  spec: z.object({
    template: z.object({
      spec: z.object({ containers: z.array(MountedContainerSchema) }),
    }),
  }),
});

describe("Home Assistant pod template", () => {
  test("renders config subPath mounts in a stable sorted order", async () => {
    const first = await synthesizeHomeAssistant();
    expect(await synthesizeHomeAssistant()).toEqual(first);

    const deployment = findManifest(
      first,
      HomeAssistantDeploymentSchema,
      "Deployment/homeassistant",
    );
    const [container] = deployment.spec.template.spec.containers;
    const subPaths = (container?.volumeMounts ?? []).flatMap((mount) =>
      mount.subPath === undefined ? [] : [mount.subPath],
    );
    expect(subPaths).toContain("configuration.yaml");
    expect(subPaths).toEqual(subPaths.toSorted());
  });
});
