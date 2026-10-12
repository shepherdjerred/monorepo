import { describe, expect, test } from "vitest";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { z } from "zod";
import { RequestSchema } from "@shepherdjerred/mc-harness/protocol/client-socket.ts";
import { exchange, socketReady, waitFor } from "./protocol.ts";

describe("preview wire protocol", () => {
  test("shares Java's valid and invalid boundary fixtures", async () => {
    const fixtures = z
      .object({ valid: z.array(z.unknown()), invalid: z.array(z.unknown()) })
      .parse(
        await Bun.file(
          path.join(import.meta.dirname, "../../client/protocol-fixtures.json"),
        ).json(),
      );
    for (const fixture of fixtures.valid)
      expect(RequestSchema.safeParse(fixture).success).toBe(true);
    for (const fixture of fixtures.invalid)
      expect(RequestSchema.safeParse(fixture).success).toBe(false);
  });

  test("handles fragmented responses and rejects mismatched correlation IDs", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "storm-wire-"));
    const socket = path.join(dir, "test.sock");
    let mismatch = false;
    const server = createServer((peer) => {
      peer.on("data", () => {
        peer.write('{"version":1,"id":"');
        peer.end(
          `${mismatch ? "wrong" : "test"}","ok":true,"result":"passed"}\n`,
        );
      });
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(socket, () => {
          resolve();
        });
      });
      const request = {
        // This must use stat rather than Bun.file().exists(), which excludes sockets.
        version: 1 as const,
        id: "test",
        action: "status",
        arguments: {},
      };
      expect(await socketReady(socket)).toBe(true);
      expect(await socketReady(path.join(dir, "missing.sock"))).toBe(false);
      expect(await exchange(socket, request)).toBe("passed");
      mismatch = true;
      await expect(exchange(socket, request)).rejects.toThrow("ID mismatch");
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("state waits have a hard timeout", async () => {
    await expect(
      waitFor(
        "never ready",
        async () => false,
        (value) => value,
        1,
      ),
    ).rejects.toThrow("never ready");
  });
});
