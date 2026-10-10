import { createSocket } from "node:dgram";
import { randomBytes } from "node:crypto";
import { rename } from "node:fs/promises";
import { z } from "zod";
import { forumManifest } from "./config.ts";
import {
  bedrockPing,
  parseBedrockPong,
  parseQueryReply,
  queryFullRequest,
  queryHandshake,
  PublicPlayersSchema,
  type QueryResult,
} from "./minecraft-query.ts";

const EditionSchema = z
  .object({
    state: z.enum(["sleeping", "starting", "online", "unavailable"]),
    version: z.string().min(1).max(100).optional(),
    verifiedAt: z.number().int().nonnegative().optional(),
  })
  .strict();
export const MinecraftStatusSchema = z
  .object({
    schemaVersion: z.literal(2),
    state: z.enum(["sleeping", "starting", "online", "unavailable"]),
    checkedAt: z.number().int().nonnegative(),
    java: EditionSchema,
    bedrock: EditionSchema,
    players: PublicPlayersSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.java.state === "online") !== (value.players !== undefined) ||
      (value.players !== undefined &&
        (new Set(value.players.names).size !== value.players.names.length ||
          value.players.names.length > value.players.maximum))
    ) {
      context.addIssue({
        code: "custom",
        message: "Minecraft cache roster does not match Java health",
      });
    }
    for (const edition of [value.java, value.bedrock]) {
      if (
        (edition.version === undefined) !==
          (edition.verifiedAt === undefined) ||
        (edition.state === "online" && edition.version === undefined)
      ) {
        context.addIssue({
          code: "custom",
          message: "Minecraft edition is missing its verified version",
        });
      }
    }
  });
export type MinecraftStatus = z.infer<typeof MinecraftStatusSchema>;
const STATUS_PATH = "/var/lib/storm-forum/status.json";
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
  if (!response.ok)
    throw new Error(
      `Minecraft workload read failed: HTTP ${String(response.status)}`,
    );
  const result = ReplicaSchema.parse(await response.json());
  return {
    desired: result.spec.replicas,
    ready: result.status?.readyReplicas ?? 0,
  };
}

// Connected UDP sockets accept replies only from the resolved backend and port.
function exchange<T>(
  port: number,
  request: Buffer,
  receive: (packet: Buffer) => Buffer | T,
): Promise<T> {
  const mc = forumManifest.minecraft;
  return new Promise((resolve, reject) => {
    const socket = createSocket("udp4");
    let finished = false;
    const finish = (error: unknown, result?: T) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      socket.close();
      if (error !== undefined)
        reject(
          error instanceof Error
            ? error
            : new Error("Minecraft UDP check failed"),
        );
      else if (result !== undefined) resolve(result);
    };
    const timeout = setTimeout(() => {
      finish(new Error("Minecraft UDP status timed out"));
    }, mc.timeoutMs);
    socket.on("error", (error) => {
      finish(error);
    });
    const send = (packet: Buffer) => {
      socket.send(packet, (error) => {
        if (error !== null) finish(error);
      });
    };
    socket.on("message", (packet) => {
      try {
        const result = receive(packet);
        if (Buffer.isBuffer(result)) send(result);
        else finish(undefined, result);
      } catch (error) {
        finish(error);
      }
    });
    socket.connect(port, mc.host, () => {
      send(request);
    });
  });
}

export function queryMinecraft(): Promise<QueryResult> {
  // GS4 preserves the low nibble of each session byte.
  const session = Buffer.from(randomBytes(4).map((value) => value & 0x0f));
  let challenged = false;
  return exchange(
    forumManifest.minecraft.queryPort,
    queryHandshake(session),
    (packet) => {
      if (!challenged) {
        challenged = true;
        return queryFullRequest(packet, session);
      }
      return parseQueryReply(packet, session);
    },
  );
}

export function pingBedrock(): Promise<{ version: string }> {
  const timestamp = BigInt(Date.now());
  return exchange(
    forumManifest.minecraft.bedrockPort,
    bedrockPing(timestamp, randomBytes(8)),
    (packet) => parseBedrockPong(packet, timestamp),
  );
}

type Checks = {
  replicas: typeof readReplicas;
  java: () => Promise<QueryResult>;
  bedrock: typeof pingBedrock;
  report: (check: string, error: unknown) => void;
};
const defaults: Checks = {
  replicas: readReplicas,
  java: queryMinecraft,
  bedrock: pingBedrock,
  report: (check, error) => {
    console.warn("Minecraft status check failed", {
      check,
      reason: error instanceof Error ? error.message : "Unknown failure",
    });
  },
};

export async function refreshMinecraftStatus(
  checks: Partial<Checks> = {},
  previous?: MinecraftStatus,
): Promise<MinecraftStatus> {
  const run = { ...defaults, ...checks };
  const checkedAt = Math.floor(Date.now() / 1000);
  const edition = (
    state: MinecraftStatus["state"],
    prior?: MinecraftStatus["java"],
  ): MinecraftStatus["java"] => ({
    state,
    ...(prior?.version === undefined
      ? {}
      : { version: prior.version, verifiedAt: prior.verifiedAt }),
  });
  const result: MinecraftStatus = {
    schemaVersion: 2,
    state: "unavailable",
    checkedAt,
    java: edition("unavailable", previous?.java),
    bedrock: edition("unavailable", previous?.bedrock),
  };
  try {
    const workload = await run.replicas();
    if (workload.desired === 0 || workload.ready === 0) {
      result.state = workload.desired === 0 ? "sleeping" : "starting";
      result.java.state = result.state;
      result.bedrock.state = result.state;
      return result;
    }
  } catch (error) {
    run.report("workload", error);
    return result;
  }
  const [java, bedrock] = await Promise.allSettled([run.java(), run.bedrock()]);
  if (java.status === "fulfilled") {
    result.java = {
      state: "online",
      version: java.value.version,
      verifiedAt: checkedAt,
    };
    result.players = { maximum: java.value.maximum, names: java.value.names };
    result.state = "online";
  } else run.report("java-query", java.reason);
  if (bedrock.status === "fulfilled") {
    result.bedrock = {
      state: "online",
      version: bedrock.value.version,
      verifiedAt: checkedAt,
    };
    result.state = "online";
  } else run.report("bedrock-ping", bedrock.reason);
  return MinecraftStatusSchema.parse(result);
}

export async function readMinecraftStatus(): Promise<
  MinecraftStatus | undefined
> {
  if (!(await Bun.file(STATUS_PATH).exists())) return undefined;
  const data: unknown = await Bun.file(STATUS_PATH).json();
  // Explicit migration of the previous count-only cache; a refresh replaces it.
  const legacy = z
    .object({
      state: z.enum(["sleeping", "starting", "online", "unavailable"]),
      checkedAt: z.number().int().nonnegative(),
      online: z.number().int().nonnegative().optional(),
      maximum: z.number().int().nonnegative().optional(),
    })
    .strict()
    .safeParse(data);
  return legacy.success ? undefined : MinecraftStatusSchema.parse(data);
}

export async function updateMinecraftStatus(): Promise<void> {
  const status = await refreshMinecraftStatus({}, await readMinecraftStatus());
  const temporary = `${STATUS_PATH}.${crypto.randomUUID()}.tmp`;
  await Bun.write(temporary, JSON.stringify(status));
  await rename(temporary, STATUS_PATH);
}
