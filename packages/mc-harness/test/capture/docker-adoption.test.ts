import { it, expect, vi } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer, createConnection } from "node:net";
import { SandboxStore, type SandboxRecord } from "#sandbox/record.ts";
import { DockerSandboxProvider } from "#providers/docker/provider.ts";
import * as cli from "#providers/docker/docker-cli.ts";

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

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "docker-adoption-"));
  const backend = createServer((socket) =>
    socket.on("data", (bytes) => socket.end(bytes)),
  );
  await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const address = backend.address();
  if (address === null || typeof address === "string")
    throw new Error("No backend");
  let pause:
    | {
        operation: string;
        entered: ReturnType<typeof Promise.withResolvers<null>>;
        release: ReturnType<typeof Promise.withResolvers<null>>;
      }
    | undefined;
  const docker = vi.spyOn(cli, "docker").mockImplementation(async (argv) => {
    if (pause !== undefined && pause.operation === argv[0]) {
      const held = pause;
      pause = undefined;
      held.entered.resolve(null);
      await held.release.promise;
    }
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
  await store.write(record);
  const first = new DockerSandboxProvider({ repoRoot: root, store });
  const second = new DockerSandboxProvider({ repoRoot: root, store });
  return {
    root,
    store,
    first,
    second,
    docker,
    hold(operation: string) {
      const held = {
        operation,
        entered: Promise.withResolvers<null>(),
        release: Promise.withResolvers<null>(),
      };
      pause = held;
      return held;
    },
    async cleanup() {
      await first.destroy(record.id);
      await second.destroy(record.id);
      docker.mockRestore();
      await new Promise<void>((resolve) => backend.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    },
  };
}

function exchange(endpoint: { host: string; port: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = createConnection(endpoint);
    client.once("error", reject);
    client.once("data", (data) => {
      client.destroy();
      resolve(data.toString());
    });
    client.write("minecraft-handshake");
  });
}

it("adopts running real-map containers with a new persisted admission proxy", async () => {
  const f = await fixture();
  try {
    const [before] = await f.first.list();
    const [[adopted], [concurrent]] = await Promise.all([
      f.second.list(),
      f.second.list(),
    ]);
    if (adopted === undefined) throw new Error("Missing adopted sandbox");
    expect(adopted.status).toBe("ready");
    expect(adopted.endpoints.game).not.toEqual(before?.endpoints.game);
    expect(concurrent?.endpoints.game).toEqual(adopted.endpoints.game);
    const persisted = await f.store.read(record.id);
    expect(persisted?.endpoints.game).toEqual(adopted.endpoints.game);
    expect(await exchange(adopted.endpoints.game)).toContain(
      "PROXY TCP4 198.51.100.10",
    );
  } finally {
    await f.cleanup();
  }
});

it("returns the current endpoint when another listing finishes adoption first", async () => {
  const f = await fixture();
  const held = f.hold("ps");
  try {
    const slow = f.second.list();
    await held.entered.promise;
    const [fast] = await f.second.list();
    held.release.resolve(null);
    const [delayed] = await slow;
    expect(delayed?.endpoints.game).toEqual(fast?.endpoints.game);
    expect(delayed?.endpoints.game.port).not.toBe(1);
  } finally {
    held.release.resolve(null);
    await f.cleanup();
  }
});

it("finishes pending adoption before removal and leaves no record or listener", async () => {
  const f = await fixture();
  const held = f.hold("port");
  try {
    const adopting = f.second.list();
    await held.entered.promise;
    const removing = f.second.destroy(record.id);
    expect(f.docker.mock.calls.some(([argv]) => argv[0] === "rm")).toBe(false);
    held.release.resolve(null);
    const [adopted] = await adopting;
    await removing;
    if (adopted === undefined) throw new Error("Missing adopted sandbox");
    await expect(exchange(adopted.endpoints.game)).rejects.toMatchObject({
      code: "ECONNREFUSED",
    });
    expect(await f.store.read(record.id)).toBeNull();
    expect(await f.second.list()).toEqual([]);
  } finally {
    held.release.resolve(null);
    await f.cleanup();
  }
});

it("keeps complete private records visible during concurrent endpoint updates", async () => {
  const f = await fixture();
  try {
    const writing = (async () => {
      for (let i = 0; i < 20; i++)
        await f.store.write({
          ...record,
          owner: "x".repeat(65_536),
          bootMs: i,
        });
    })();
    for (let i = 0; i < 40; i++) {
      const current = await f.store.read(record.id);
      expect(current?.secrets).toEqual(record.secrets);
    }
    await writing;
    const metadata = await stat(
      path.join(f.store.dir(record.id), "record.json"),
    );
    expect(metadata.mode & 0o777).toBe(0o600);
  } finally {
    await f.cleanup();
  }
});
