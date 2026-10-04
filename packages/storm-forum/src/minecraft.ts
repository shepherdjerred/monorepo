import { createConnection } from "node:net";
import { rename } from "node:fs/promises";
import { z } from "zod";
import { forumManifest } from "./config.ts";
import { statusRequest, parseStatusPacket } from "./minecraft-protocol.ts";

export type MinecraftStatus = {
  state: "sleeping" | "starting" | "online" | "unavailable";
  checkedAt: number;
  online?: number;
  maximum?: number;
};
const ReplicaSchema = z.object({
  spec: z.object({ replicas: z.number().int().nonnegative() }),
  status: z
    .object({ readyReplicas: z.number().int().nonnegative().optional() })
    .optional(),
});

export async function readReplicas(): Promise<{
  desired: number;
  ready: number;
}> {
  const mc = forumManifest.minecraft;
  const token = await Bun.file(
    "/var/run/secrets/kubernetes.io/serviceaccount/token",
  ).text();
  const ca = await Bun.file(
    "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt",
  ).text();
  const response = await fetch(
    `https://kubernetes.default.svc/apis/apps/v1/namespaces/${mc.namespace}/statefulsets/${mc.statefulSet}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      tls: { ca },
      signal: AbortSignal.timeout(mc.timeoutMs),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Minecraft workload read failed: HTTP ${String(response.status)}`,
    );
  }
  const result = ReplicaSchema.parse(await response.json());
  return {
    desired: result.spec.replicas,
    ready: result.status?.readyReplicas ?? 0,
  };
}

export function pingMinecraft(): Promise<{ online: number; maximum: number }> {
  const mc = forumManifest.minecraft;
  return new Promise((resolve, reject) => {
    let received = Buffer.alloc(0);
    const socket = createConnection({ host: mc.host, port: mc.port });
    const finish = (
      error?: Error,
      result?: { online: number; maximum: number },
    ) => {
      socket.destroy();
      if (error !== undefined) {
        reject(error);
      } else if (result !== undefined) {
        resolve(result);
      }
    };
    socket.setTimeout(mc.timeoutMs, () => {
      finish(new Error("Minecraft status timed out"));
    });
    socket.on("error", (error) => {
      finish(error);
    });
    socket.on("end", () => {
      finish(new Error("Minecraft closed before a complete status response"));
    });
    socket.on("connect", () => {
      socket.write(statusRequest(mc.host, mc.port));
    });
    socket.on("data", (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);
      try {
        const result = parseStatusPacket(received);
        if (result !== undefined) {
          finish(undefined, result);
        }
      } catch (error) {
        finish(
          error instanceof Error
            ? error
            : new Error("Invalid Minecraft response"),
        );
      }
    });
  });
}

export async function refreshMinecraftStatus(
  replicas: () => Promise<{ desired: number; ready: number }> = readReplicas,
  ping: () => Promise<{ online: number; maximum: number }> = pingMinecraft,
): Promise<MinecraftStatus> {
  const checkedAt = Math.floor(Date.now() / 1000);
  try {
    const state = await replicas();
    if (state.desired === 0) {
      return { state: "sleeping", checkedAt };
    }
    return state.ready === 0
      ? { state: "starting", checkedAt }
      : { state: "online", checkedAt, ...(await ping()) };
  } catch {
    // Expected external outage; the cached widget explicitly reports unavailable.
    return { state: "unavailable", checkedAt };
  }
}

export async function writeMinecraftStatus(
  status: MinecraftStatus,
): Promise<void> {
  const path = "/var/lib/storm-forum/status.json";
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  await Bun.write(temporary, JSON.stringify(status));
  await rename(temporary, path);
}
