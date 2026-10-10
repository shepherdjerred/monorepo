import { z } from "zod";
import { request, StatusSchema, waitFor, type Session } from "./protocol.ts";

export async function status(session: Session) {
  return StatusSchema.parse(await request(session, "status"));
}

export async function viewpoint(session: Session, name: string): Promise<void> {
  const view = z
    .object({
      position: z.tuple([z.number(), z.number(), z.number()]),
      yaw: z.number(),
      pitch: z.number(),
    })
    .parse(await request(session, "viewpoint", { name }));
  await waitFor(
    "viewpoint arrival",
    () => status(session),
    (state) =>
      state.connected &&
      state.position.every(
        (n, i) => Math.abs(n - (view.position[i] ?? Infinity)) < 0.8,
      ),
  );
  await request(session, "look", { yaw: view.yaw, pitch: view.pitch });
  await waitFor(
    "rendered viewpoint",
    () => status(session),
    (state) => state.connected && state.fps > 0,
  );
  await Bun.sleep(1500);
}
