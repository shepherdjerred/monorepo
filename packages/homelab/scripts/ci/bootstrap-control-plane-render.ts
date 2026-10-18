import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseAllDocuments } from "yaml";
import { z } from "zod";

const hosts = {
  "temporal-delivery-worker": "delivery",
  "temporal-delivery-platform-worker": "delivery-platform",
  "temporal-delivery-workflows": "delivery-workflows",
} as const;
const deployment = z.object({
  metadata: z.object({ name: z.string(), namespace: z.literal("temporal") }),
  spec: z.object({
    replicas: z.literal(1),
    template: z.object({
      spec: z.object({
        automountServiceAccountToken: z.boolean(),
        containers: z.tuple([
          z.object({
            image: z.string(),
            env: z.array(
              z.object({
                name: z.string(),
                value: z.string().optional(),
                valueFrom: z.unknown().optional(),
              }),
            ),
          }),
        ]),
      }),
    }),
  }),
});

export function requireBootstrapControlPlaneHosts(
  manifests: unknown[],
  reference: string,
) {
  for (const [name, role] of Object.entries(hosts)) {
    const matching = manifests.filter((raw) => {
      const identity = z
        .object({ kind: z.string(), metadata: z.object({ name: z.string() }) })
        .parse(raw);
      return identity.kind === "Deployment" && identity.metadata.name === name;
    });
    if (matching.length !== 1)
      throw new Error(
        `Original qualified control-plane chart lacks its unique ${role} host`,
      );
    const host = deployment.parse(matching[0]);
    const container = host.spec.template.spec.containers[0];
    const environment = new Map<string, string | undefined>();
    for (const item of container.env) {
      if (environment.has(item.name))
        throw new Error(
          "Control-plane host has duplicate environment declarations",
        );
      environment.set(item.name, item.value);
    }
    if (
      container.image !== reference ||
      environment.get("TEMPORAL_WORKER_ROLE") !== role ||
      environment.get("TEMPORAL_NAMESPACE") !== "prod" ||
      environment.get("TEMPORAL_ADDRESS") !==
        "temporal-temporal-server-service:7233"
    )
      throw new Error(
        "Original qualified control-plane host differs from its exact image or fixed Temporal role",
      );
    if (
      role === "delivery-workflows" &&
      (host.spec.template.spec.automountServiceAccountToken ||
        container.env.some((item) => item.valueFrom !== undefined))
    )
      throw new Error(
        "Delivery Workflow bootstrap host must remain credentialless",
      );
  }
}

/** Inspect the unchanged verified archive offline; no repository, cluster or credential configuration is inherited. */
export async function renderBootstrapControlPlane(
  bytes: Uint8Array,
  image: { uri: string; version: string; digest: string },
) {
  const directory = await mkdtemp(
    path.join(tmpdir(), "delivery-bootstrap-render-"),
  );
  try {
    const archive = path.join(directory, "original.tgz");
    await Bun.write(archive, bytes, { mode: 0o600 });
    const reference = `${image.uri}:${image.version}@${image.digest}`;
    const result = spawnSync(
      "helm",
      [
        "template",
        "delivery-control-plane",
        archive,
        "--namespace",
        "temporal",
        "--set-string",
        `delivery.images.delivery-control-plane=${reference}`,
      ],
      {
        cwd: directory,
        env: { PATH: Bun.env["PATH"], HOME: directory },
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    if (result.status !== 0 || result.error !== undefined)
      throw new Error(
        "Cannot render original qualified control-plane chart within its time/output bound",
      );
    const manifests = parseAllDocuments(result.stdout)
      .map((doc) => {
        if (doc.errors.length > 0)
          throw new Error("Original control-plane chart rendered invalid YAML");
        return doc.toJSON() as unknown;
      })
      .filter((value) => value !== null);
    requireBootstrapControlPlaneHosts(manifests, reference);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
