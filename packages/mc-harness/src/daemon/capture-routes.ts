import { z } from "zod";
import { CaptureCleanupRequestSchema } from "#protocol/capture.ts";
import { BoxSchema } from "#protocol/bridge.ts";
import { body, DaemonError } from "./http.ts";
import { guarded } from "./live-routes.ts";
import type { ClientManager } from "./clients.ts";
import type { LiveService } from "#src/live/service.ts";
import type { Target } from "#src/target.ts";

export async function capturePost(call: {
  ctx: { clients: ClientManager; live: LiveService };
  request: Request;
  target: Target;
  action: string;
}): Promise<Response | null> {
  const { ctx, request, target, action } = call;
  const { bridge, id } = target;
  switch (action) {
    case "capture-player": {
      const { name } = await body(
        request,
        z.strictObject({ name: z.string().regex(/^\w{3,16}$/u) }),
      );
      return Response.json(await bridge.capturePlayer(name));
    }
    case "capture-cleanup": {
      const input = await body(request, CaptureCleanupRequestSchema);
      const controlled = ctx.clients
        .list()
        .find((client) => client.name === input.name && client.target === id);
      if (controlled === undefined)
        throw new DaemonError(
          "Resource cleanup requires the owned client",
          409,
        );
      return Response.json(
        await guarded(
          call,
          () =>
            Promise.resolve({
              kind: "command",
              command: "capture-resource-cleanup",
            }),
          (live) => live.bridge.captureCleanup(input),
        ),
      );
    }
    case "capture-player-restore": {
      const { PlayerRestoreSchema } = await import("#protocol/capture.ts");
      const input = await body(request, PlayerRestoreSchema);
      const controlled = ctx.clients
        .list()
        .find(
          (client) =>
            client.name === input.checkpoint.name && client.target === id,
        );
      if (controlled === undefined)
        throw new DaemonError(
          "Recovery requires the owned client session",
          409,
        );
      const { state } = await ctx.clients.status(controlled.name);
      if (!state.connected || state["uuid"] !== input.checkpoint.uuid)
        throw new DaemonError("Recovery player identity differs", 409);
      return Response.json(
        await guarded(
          call,
          () =>
            Promise.resolve({
              kind: "command",
              command: "capture-player-restore",
            }),
          (live) => live.bridge.restoreCapturePlayer(input),
        ),
      );
    }
    case "capture-inspect": {
      const box = await body(request, BoxSchema);
      return Response.json(await bridge.captureInspect(box));
    }
  }
  return null;
}
