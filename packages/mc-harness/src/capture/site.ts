import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { MC_DIR } from "#protocol/paths.ts";
import {
  BoxSchema,
  InfoResponseSchema,
  SnapshotSchema,
} from "#protocol/bridge.ts";
import {
  ClientStatusResponseSchema,
  ClientActionResponseSchema,
  ClientCaptureResponseSchema,
  type ClientState,
} from "#protocol/client.ts";
import { CaptureInspectionSchema } from "#protocol/capture.ts";
import { CaptureTransport } from "./transport.ts";

const captures = path.join(MC_DIR, "captures");
export const SiteSchema = z.strictObject({
  schema: z.literal(1),
  id: z.string(),
  target: z.string(),
  name: z.string(),
  world: z.string(),
  anchor: z.tuple([z.number(), z.number(), z.number()]),
  box: BoxSchema,
  snapshot: z.string(),
  inspection: z.record(z.string(), z.string()),
});
export type CaptureOptions = {
  target?: string | undefined;
  account?: string | undefined;
  reason?: string | undefined;
  site?: string | undefined;
  docs?: string | undefined;
};

export function required(value: string | undefined, label: string): string {
  if (value === undefined || value === "")
    throw new Error(`${label} is required`);
  return value;
}
function print(value: unknown): void {
  process.stdout.write(
    `${typeof value === "string" ? value : JSON.stringify(value)}\n`,
  );
}
export async function doctor(options: CaptureOptions): Promise<void> {
  const checks = ["bun", "mise", "ffmpeg", "ffprobe"].map((tool) => ({
    layer: "tooling",
    tool,
    ready: Bun.which(tool) !== null,
  }));
  print(JSON.stringify(checks, null, 2));
  if (checks.some((check) => !check.ready))
    throw new Error("Required capture tooling is unavailable");
  const target = required(options.target, "--target");
  const transport = new CaptureTransport(target, "capture preflight");
  if (
    target === "live" &&
    (process.platform !== "darwin" ||
      !(await Bun.file(
        "/Applications/Prism Launcher.app/Contents/MacOS/prismlauncher",
      ).exists()) ||
      !(await Bun.file(
        path.join(
          os.homedir(),
          "Library/Application Support/PrismLauncher/instances/26.3/mmc-pack.json",
        ),
      ).exists()))
  )
    throw new Error(
      "Authenticated launch requires macOS, Prism, and its existing 26.3 instance",
    );
  const info = await transport.world(InfoResponseSchema, "info");
  print({ layer: "server", info });
  if (!info.capabilities.includes("capture"))
    throw new Error(
      "Server artifact lacks the capture capability; release the matching bridge before running scenes",
    );
  const name = options.account ?? "XiguaJerred";
  const client = await transport.request(
    ClientStatusResponseSchema,
    "GET",
    `/clients/${encodeURIComponent(name)}`,
  );
  if (
    client.client.target !== target ||
    !client.state.connected ||
    client.state.fps <= 0
  )
    throw new Error(
      "Owned client is not connected and rendering on the requested target",
    );
  print({ layer: "client", name, connected: true, fps: client.state.fps });
  return;
}

async function scoutSite(
  transport: CaptureTransport,
  route: string,
  directory: string,
  arrived: ClientState,
): Promise<void> {
  for (const yaw of [0, 90, 180, 270]) {
    const before = await transport.request(
      ClientStatusResponseSchema,
      "GET",
      route,
    );
    await transport.request(
      ClientActionResponseSchema,
      "POST",
      `${route}/look`,
      { yaw, pitch: 15 },
    );
    const frameDeadline = performance.now() + 15_000;
    let rendered = false;
    while (performance.now() < frameDeadline) {
      const current = await transport.request(
        ClientStatusResponseSchema,
        "GET",
        route,
      );
      const a = before.state["renderedFrames"],
        b = current.state["renderedFrames"];
      if (typeof a === "number" && typeof b === "number" && b >= a + 3) {
        rendered = true;
        break;
      }
      await Bun.sleep(50);
    }
    if (!rendered) throw new Error("No fresh rendered scouting frame");
    await transport.request(
      ClientCaptureResponseSchema,
      "POST",
      `${route}/capture`,
      { out: path.join(directory, `view-${yaw.toString()}.png`) },
    );
  }
  await transport.request(ClientActionResponseSchema, "POST", `${route}/look`, {
    yaw: arrived.yaw,
    pitch: arrived.pitch,
  });
}

export async function findSite(
  argument: string | undefined,
  options: CaptureOptions,
): Promise<void> {
  if (argument !== "find") throw new Error("Use capture site find");
  const target = required(options.target, "--target");
  const reason = required(options.reason, "--reason");
  const name = options.account ?? "XiguaJerred";
  const transport = new CaptureTransport(target, reason);
  const route = `/clients/${encodeURIComponent(name)}`;
  const initial = await transport.request(
    ClientStatusResponseSchema,
    "GET",
    route,
  );
  if (!initial.state.connected || initial.client.target !== target)
    throw new Error("Client is not connected to the requested target");
  const origin = initial.state.position;
  await transport.request(
    ClientActionResponseSchema,
    "POST",
    `${route}/command`,
    { text: "rtp" },
  );
  let arrived: ClientState = initial.state;
  const deadline = performance.now() + 120_000;
  while (performance.now() < deadline) {
    const response = await transport.request(
      ClientStatusResponseSchema,
      "GET",
      route,
    );
    arrived = response.state;
    if (
      arrived.connected &&
      Math.hypot(
        ...arrived.position.map(
          (value, index) => value - (origin[index] ?? value),
        ),
      ) > 16
    )
      break;
    await Bun.sleep(200);
  }
  if (
    !arrived.connected ||
    Math.hypot(
      ...arrived.position.map(
        (value, index) => value - (origin[index] ?? value),
      ),
    ) <= 16
  )
    throw new Error(
      "RTP did not arrive; inspect recent client messages for price/cooldown feedback",
    );
  const info = await transport.world(InfoResponseSchema, "info");
  const world = info.worlds.find(
    (candidate) => candidate.key === arrived.world,
  );
  if (world === undefined) throw new Error("RTP world is not registered");
  const [x, y, zz] = arrived.position.map((value) => Math.floor(value));
  if (x === undefined || y === undefined || zz === undefined)
    throw new Error("Missing position");
  const box = {
    world: world.name,
    min: { x: x - 12, y: y - 2, z: zz - 12 },
    max: { x: x + 12, y: y + 10, z: zz + 12 },
  };
  const { inspection } = await transport.world(
    CaptureInspectionSchema,
    "capture-inspect",
    box,
  );
  if (inspection["wilderness"] !== "true")
    throw new Error(
      "RTP site includes protected or claimed land; find another site",
    );
  const id = `site-${randomUUID()}`;
  const directory = path.join(captures, id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const snapshot = await transport.world(SnapshotSchema, "snapshot", {
    box,
    label: id,
  });
  const site = SiteSchema.parse({
    schema: 1,
    id,
    target,
    name,
    world: world.name,
    anchor: [x, y, zz],
    box,
    snapshot: snapshot.id,
    inspection,
  });
  await Bun.write(
    path.join(directory, "site.json"),
    JSON.stringify(site, null, 2),
  );
  await scoutSite(transport, route, directory, arrived);
  print(path.join(directory, "site.json"));
  return;
}
