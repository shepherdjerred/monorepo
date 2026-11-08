import path from "node:path";
import { z } from "zod";
import { CaptureTransport } from "#src/capture/transport.ts";
import { createCaptureSaver } from "#src/capture/artifacts.ts";
import { save, type CaptureRun } from "#src/capture/model.ts";
import {
  ClientStatusResponseSchema,
  ClientActionResponseSchema,
  ClientCaptureResponseSchema,
} from "#protocol/client.ts";
import { InfoResponseSchema, PlayersResponseSchema } from "#protocol/bridge.ts";
import { SandboxListResponseSchema } from "#protocol/ipc.ts";
import type { Presentation } from "#protocol/media.ts";
import { isImportedWorld } from "#sandbox/map-provenance.ts";

type Transport = Pick<CaptureTransport, "request" | "world">;
const Menu = z.object({
  connected: z.literal(false),
  screen: z.literal("Play Multiplayer"),
  renderedFrames: z.number(),
  fps: z.number().positive(),
  servers: z.array(
    z.object({
      name: z.string(),
      address: z.string(),
      state: z.string(),
      ping: z.number(),
    }),
  ),
});
/** Authenticate the real-map session before disconnecting; then prove a real successful server ping. */
export async function captureServerList(
  directory: string,
  run: CaptureRun,
  shot: Presentation,
  transport: Transport = new CaptureTransport(
    run.target,
    run.reason,
    undefined,
    run.name,
  ),
) {
  if (run.target === "live" || run.mode !== "client-ui")
    throw new Error("Client UI capture requires its owned local session");
  const route = `/clients/${run.name}`;
  try {
    const before = await transport.request(
      ClientStatusResponseSchema,
      "GET",
      route,
    );
    const info = await transport.world(InfoResponseSchema, "info");
    const { sandboxes } = await transport.request(
      SandboxListResponseSchema,
      "GET",
      "/sandboxes",
    );
    const sandbox = sandboxes.find((s) => s.id === run.target);
    const { players } = await transport.world(PlayersResponseSchema, "players");
    if (
      before.client.target !== run.target ||
      !before.state.connected ||
      !players.some(
        (p) =>
          !p.npc &&
          p.name === run.name &&
          p.uuid === before.state["uuid"] &&
          p.world === run.box.world,
      ) ||
      sandbox?.world !== "real-map" ||
      !isImportedWorld(sandbox.mapSource, run.box.world, info)
    )
      throw new Error("Client UI origin does not match its real-map server");
    run.server = info;
    run.mapSource = sandbox.mapSource;
    const renderedBefore = z
      .number()
      .int()
      .nonnegative()
      .parse(before.state["renderedFrames"]);
    run.origin = {
      world: before.state.world,
      position: before.state.position,
      yaw: before.state.yaw,
      pitch: before.state.pitch,
    };
    run.state = "capture";
    await save(directory, run);
    await transport.request(
      ClientActionResponseSchema,
      "POST",
      `${route}/server-list`,
      {},
    );
    const deadline = performance.now() + 30_000;
    let ready = false;
    while (performance.now() < deadline) {
      const { state } = await transport.request(
        ClientStatusResponseSchema,
        "GET",
        route,
      );
      const menu = Menu.safeParse(state);
      if (
        menu.success &&
        menu.data.renderedFrames >= renderedBefore + 3 &&
        menu.data.servers.some(
          (s) =>
            s.name === "The Storm" &&
            s.address === before.client.server &&
            s.state === "SUCCESSFUL" &&
            s.ping >= 0,
        )
      ) {
        ready = true;
        break;
      }
      await Bun.sleep(100);
    }
    if (!ready)
      throw new Error(
        "Multiplayer screen did not render a successful ping to its actual server",
      );
    const source = await transport.request(
      ClientCaptureResponseSchema,
      "POST",
      `${route}/capture`,
      { out: path.join(directory, `${shot.name}.png`) },
    );
    await createCaptureSaver(directory, run)(shot, source.path);
    run.state = "complete";
  } catch (error) {
    run.state = "failed";
    run.error = error instanceof Error ? error.message : String(error);
  }
  await save(directory, run);
}
