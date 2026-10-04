import { z } from "zod";
import { request, StatusSchema, waitFor, type Session } from "./protocol.ts";
import { verifyInputCancellation } from "./verify-input.ts";

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

export async function tour(session: Session): Promise<void> {
  await request(session, "close");
  await waitFor(
    "closed screen",
    () => status(session),
    (state) => state.connected && state.screen === "",
  );
  for (const name of ["lobby", "market", "mystery-box", "foundry"]) {
    await viewpoint(session, name);
    await request(session, "capture", { name });
  }
}

export async function smoke(session: Session): Promise<void> {
  await request(session, "fixture", { name: "chest" });
  await viewpoint(session, "fixture");
  await verifyInputCancellation(session);
  await request(session, "hotbar", { slot: 1 });
  await waitFor(
    "selected hotbar",
    () => status(session),
    (state) => state.connected && state.hotbar === 1,
  );
  await request(session, "hotbar", { slot: 0 });
  const before = await status(session);
  if (!before.connected) throw new Error("Client disconnected");
  await request(session, "input", { buttons: ["right"], ticks: 10 });
  const after = await status(session);
  if (
    !after.connected ||
    Math.hypot(...after.position.map((n, i) => n - (before.position[i] ?? n))) <
      0.1
  ) {
    throw new Error("Scripted movement did not move the real client");
  }
  await viewpoint(session, "fixture");
  await waitFor(
    "barrel target",
    () => status(session),
    (state) => state.connected && state.target["type"] === "minecraft:barrel",
  );
  await request(session, "use");
  const menu = await waitFor(
    "barrel menu",
    () => status(session),
    (state) => state.connected && state.containerId > 0,
  );
  if (!menu.connected) throw new Error("Client disconnected");
  await request(session, "capture", { name: "barrel-menu" });
  await request(session, "click", {
    containerId: menu.containerId,
    stateId: menu.stateId,
    slot: 0,
    button: 0,
    mode: "quick_move",
  });
  await waitFor(
    "bread delivered",
    () => status(session),
    (state) =>
      state.connected &&
      state.inventory.some(
        (item) => item.type === "minecraft:bread" && item.count >= 3,
      ),
  );
  let rejected = false;
  try {
    await request(session, "click", {
      containerId: 9999,
      stateId: 0,
      slot: 0,
      button: 0,
      mode: "pickup",
    });
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Stale container click was accepted");
  await request(session, "inventory", { open: false });
  await request(session, "inventory", { open: true });
  await request(session, "capture", { name: "inventory" });
  await request(session, "close");
  await request(session, "fixture", { name: "enemy" });
  await viewpoint(session, "enemy");
  await waitFor(
    "zombie target",
    () => status(session),
    (state) => state.connected && state.target.kind === "entity",
  );
  const healthBefore = await request(session, "fixture", {
    name: "enemy-health",
  });
  await request(session, "attack");
  await waitFor(
    "attack damage",
    () => request(session, "fixture", { name: "enemy-health" }),
    (health) => health !== healthBefore,
  );
  await request(session, "release");
  await request(session, "capture", { name: "client-world" });
  console.warn(`Real client smoke passed. Artifacts: ${session.artifacts}`);
}
