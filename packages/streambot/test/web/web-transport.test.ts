import { expect, test } from "vitest";
import { serveWebHandler } from "@shepherdjerred/streambot/web/server/start.ts";

test("a slow catalog response survives Bun's default connection idle deadline", async () => {
  const server = serveWebHandler(0, async () => {
    await new Promise((resolve) => setTimeout(resolve, 15_000));
    return Response.json([{ title: "Bears vs Packers" }]);
  });
  try {
    const response = await fetch(
      `http://127.0.0.1:${String(server.port)}/api/sports`,
      {
        signal: AbortSignal.timeout(20_000),
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ title: "Bears vs Packers" }]);
  } finally {
    await server.stop(true);
  }
}, 25_000);
