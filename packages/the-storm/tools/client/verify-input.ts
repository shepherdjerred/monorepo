import { createConnection } from "node:net";
import { randomUUID } from "node:crypto";
import { request, StatusSchema, waitFor, type Session } from "./protocol.ts";

async function held(session: Session, expected: boolean): Promise<void> {
  await waitFor(
    expected ? "held input" : "released input",
    async () => StatusSchema.parse(await request(session, "status")),
    (state) => state.connected && state.heldInputs.length > 0 === expected,
  );
}

export async function verifyInputCancellation(session: Session): Promise<void> {
  const socket = createConnection(session.socket);
  // Keep the lease connection open, then simulate a controller disappearing.
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.once("connect", () => {
        socket.write(
          `${JSON.stringify({
            version: 1,
            id: randomUUID(),
            action: "input",
            arguments: { buttons: ["sneak"], ticks: 100 },
          })}\n`,
        );
        resolve();
      });
    });
    await held(session, true);
  } finally {
    socket.destroy();
  }
  await held(session, false);

  const pending = cancelledLease(session);
  await held(session, true);
  await request(session, "release");
  if (!(await pending))
    throw new Error("Released input lease was not cancelled");
  await held(session, false);
}

async function cancelledLease(session: Session): Promise<boolean> {
  try {
    await request(session, "input", { buttons: ["sneak"], ticks: 100 });
    return false;
  } catch {
    return true;
  }
}
