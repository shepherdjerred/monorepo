import { it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer, createConnection } from "node:net";
import { SandboxStore, type SandboxRecord } from "#sandbox/record.ts";
import { DockerSandboxProvider } from "#providers/docker/provider.ts";
import * as cli from "#providers/docker/docker-cli.ts";

it("adopts running real-map containers with a new persisted admission proxy", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "docker-adoption-"));
  const backend = createServer((socket) =>
    socket.on("data", (bytes) => socket.end(bytes)),
  );
  await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const address = backend.address();
  if (address === null || typeof address === "string")
    throw new Error("No backend");
  const docker = vi.spyOn(cli, "docker").mockImplementation(async (argv) => {
    if (argv[0] === "ps")
      return {
        stdout:
          "abcdef123456\tsbx-abc123\t2099-01-01T00:00:00.000Z\ttrue\trunning\n",
        stderr: "",
      };
    if (argv[0] === "port")
      return { stdout: `127.0.0.1:${address.port.toString()}\n`, stderr: "" };
    if (argv[0] === "rm") return { stdout: "", stderr: "" };
    throw new Error(`Unexpected Docker operation ${String(argv[0])}`);
  });
  const store = new SandboxStore(root);
  const record: SandboxRecord = {
    id: "sbx-abc123",
    provider: "docker",
    profile: "storm-dev",
    world: "real-map",
    status: "ready",
    keep: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    bootMs: 1,
    endpoints: {
      game: { host: "127.0.0.1", port: 1 },
      bridge: { host: "127.0.0.1", port: 2 },
      rcon: { host: "127.0.0.1", port: 3 },
    },
    providerRef: { kind: "docker", containerId: "abcdef123456" },
    owner: "test",
    secrets: { bridgeToken: "a".repeat(48), rconPassword: "b".repeat(48) },
  };
  const first = new DockerSandboxProvider({ repoRoot: root, store });
  const second = new DockerSandboxProvider({ repoRoot: root, store });
  try {
    await store.write(record);
    const [before] = await first.list();
    const [[adopted], [concurrent]] = await Promise.all([
      second.list(),
      second.list(),
    ]);
    if (adopted === undefined) throw new Error("Missing adopted sandbox");
    expect(adopted.status).toBe("ready");
    expect(adopted.endpoints.game).not.toEqual(before?.endpoints.game);
    expect(concurrent?.endpoints.game).toEqual(adopted.endpoints.game);
    const persisted = await store.read(record.id);
    expect(persisted?.endpoints.game).toEqual(adopted.endpoints.game);
    const received = Promise.withResolvers<string>();
    const client = createConnection(adopted.endpoints.game);
    client.once("error", received.reject);
    client.once("data", (data) => {
      client.destroy();
      received.resolve(data.toString());
    });
    client.write("minecraft-handshake");
    expect(await received.promise).toContain("PROXY TCP4 198.51.100.10");
  } finally {
    await first.destroy(record.id);
    await second.destroy(record.id);
    docker.mockRestore();
    await new Promise<void>((resolve) => backend.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
