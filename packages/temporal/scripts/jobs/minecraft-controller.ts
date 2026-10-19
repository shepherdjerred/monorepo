import { CoreV1Api, KubeConfig } from "@kubernetes/client-node";
import type { Server } from "bun";
import { z } from "zod";
import {
  DeploymentDetailSchema,
  MinecraftRecoveryDetailSchema,
} from "@shepherdjerred/delivery/contract";
import { deliveryRequest } from "#lib/delivery/client.ts";
import { MinecraftControllerProcess } from "#lib/delivery/minecraft-controller-process.ts";
import { createMinecraftControllerServer } from "#lib/delivery/minecraft-controller-server.ts";
import { runMinecraftProducer } from "#lib/delivery/minecraft-controller-error.ts";

const config = new KubeConfig();
config.loadFromCluster();
const core = config.makeApiClient(CoreV1Api);
const executor = new MinecraftControllerProcess({
  journalRoot: "/journal",
  producerRoot: new URL("../../../the-storm/server/", import.meta.url).pathname,
  async identity() {
    const namespace = "delivery-tsmc-controller",
      name = "delivery-tsmc-controller-0";
    const pod = await core.readNamespacedPod({ namespace, name });
    return { namespace, name, uid: z.string().min(1).parse(pod.metadata?.uid) };
  },
  process: runMinecraftProducer,
});
const app = createMinecraftControllerServer({
  token: z.string().min(16).parse(Bun.env["DELIVERY_EXECUTOR_TOKEN"]),
  toolingRevision: z
    .string()
    .regex(/^[a-f0-9]{40}$/u)
    .parse(Bun.env["GIT_SHA"]),
  process: executor,
  load: async (id) =>
    await deliveryRequest(
      `deployments/${encodeURIComponent(id)}`,
      DeploymentDetailSchema,
    ),
  admit: async (id) =>
    await deliveryRequest(
      `deployments/${encodeURIComponent(id)}/claim`,
      DeploymentDetailSchema,
      {},
    ),
  loadRecovery: async (id) =>
    await deliveryRequest(
      `minecraft-recovery/${encodeURIComponent(id)}`,
      MinecraftRecoveryDetailSchema,
    ),
  longRequest: (request) => {
    server.timeout(request, 0);
  },
});
const server: Server<undefined> = Bun.serve({
  hostname: "0.0.0.0",
  port: 7356,
  idleTimeout: 255,
  maxRequestBodySize: 1024,
  fetch: app.fetch,
});
