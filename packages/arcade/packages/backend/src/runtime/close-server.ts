import type { Server } from "node:net";

export async function closeServer(
  server: Pick<Server, "listening" | "close">,
): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}
