import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BridgeClient, BridgeRequestError } from "#bridge/client.ts";

const token = "a".repeat(48);
let server: ReturnType<typeof Bun.serve>;
let client: BridgeClient;
const seen: { path: string; auth: string | null; body: unknown }[] = [];

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const body: unknown =
        request.method === "POST" ? await request.json() : undefined;
      seen.push({
        path: `${url.pathname}${url.search}`,
        auth: request.headers.get("authorization"),
        body,
      });
      switch (url.pathname) {
        case "/v1/health": {
          return Response.json({
            ok: true,
            apiVersion: 1,
            bridgeVersion: "0.1.0",
          });
        }
        case "/v1/command": {
          return Response.json({
            success: true,
            output: ["There are 0 of a max of 20 players online"],
          });
        }
        case "/v1/players": {
          // Off-contract: an extra key must be rejected, not ignored.
          return Response.json({ players: [], extra: true });
        }
        case "/v1/we/undo": {
          return Response.json(
            { error: "Nothing left to undo", code: "world_edit" },
            { status: 409 },
          );
        }
        case "/v1/events": {
          return Response.json({ cursor: 3, truncated: false, events: [] });
        }
        case "/v1/snapshots/snap-1": {
          return new Response(new Uint8Array([1, 2, 3]));
        }
      }
      return new Response("nope", { status: 500 });
    },
  });
  client = new BridgeClient({
    baseUrl: `http://127.0.0.1:${String(server.port)}`,
    token,
  });
});

afterAll(async () => {
  await server.stop(true);
});

describe("BridgeClient", () => {
  it("sends the bearer token and validates responses", async () => {
    await expect(client.health()).resolves.toEqual({
      ok: true,
      apiVersion: 1,
      bridgeVersion: "0.1.0",
    });
    expect(seen.at(-1)?.auth).toBe(`Bearer ${token}`);
  });

  it("posts command bodies", async () => {
    const result = await client.command("list");
    expect(result.success).toBe(true);
    expect(seen.at(-1)?.body).toEqual({ command: "list" });
  });

  it("rejects a response outside the contract", async () => {
    await expect(client.players()).rejects.toMatchObject({ code: "contract" });
  });

  it("maps bridge errors to typed errors", async () => {
    const undo = client.weUndo({ session: "agent", steps: 1 });
    await expect(undo).rejects.toBeInstanceOf(BridgeRequestError);
    await expect(undo).rejects.toMatchObject({
      status: 409,
      code: "world_edit",
    });
  });

  it("refuses an invalid request before sending it", () => {
    expect(() =>
      client.weRun({
        session: "Agent!",
        world: "world",
        ops: [{ command: "//set stone" }],
      }),
    ).toThrow();
  });

  it("encodes event cursors and downloads snapshot bytes", async () => {
    await client.events(7, 50);
    expect(seen.at(-1)?.path).toBe("/v1/events?since=7&limit=50");
    expect([...(await client.snapshotBytes("snap-1"))]).toEqual([1, 2, 3]);
  });

  it("reports non-JSON failures with the status", async () => {
    await expect(client.registry()).rejects.toMatchObject({
      status: 500,
      code: "contract",
    });
  });
});
