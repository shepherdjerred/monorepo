import { it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { localRollout, rolloutListenHost } from "#src/capture/suite/rollout.ts";
import { memoryStore } from "./suite-fixtures.ts";
import { SandboxCreateRequestSchema } from "#protocol/ipc.ts";

const loopback = () => Promise.resolve("127.0.0.1");

it("binds Linux readers to Docker's IPv4 bridge and preserves Desktop loopback routing", async () => {
  const inspected: string[][] = [];
  const inspect = (argv: string[]) => {
    inspected.push(argv);
    return Promise.resolve('[{"Gateway":"fd00::1"},{"Gateway":"172.17.0.1"}]');
  };
  expect(await rolloutListenHost("darwin", inspect)).toBe("127.0.0.1");
  expect(inspected).toEqual([]);
  expect(await rolloutListenHost("linux", inspect)).toBe("172.17.0.1");
  expect(inspected).toEqual([
    [
      "docker",
      "network",
      "inspect",
      "bridge",
      "--format",
      "{{json .IPAM.Config}}",
    ],
  ]);
  await expect(
    rolloutListenHost("linux", () =>
      Promise.resolve('[{"Gateway":"fd00::1"}]'),
    ),
  ).rejects.toThrow("IPv4 gateway");
});

it("records the first real evaluation and replays it after upstream disappears", async () => {
  let enabled = true,
    calls = 0;
  const upstream = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => {
      calls++;
      return Response.json({ enabled });
    },
  });
  const store = memoryStore();
  const cache = await mkdtemp(path.join(os.tmpdir(), "rollout-test-"));
  const recorder = await localRollout(
    {
      source: {
        url: `http://127.0.0.1:${String(upstream.port)}`,
        environment: "prod",
      },
      store,
      cache,
    },
    loopback,
  );
  const request = {
    namespace_key: "the-storm",
    flag_key: "example",
    entity_id: "camera",
    context: {},
  };
  const evaluate = async (url: string) => {
    const result = await fetch(
      new URL(
        "/evaluate/v1/boolean",
        url.replace("host.docker.internal", "127.0.0.1"),
      ),
      { method: "POST", body: JSON.stringify(request) },
    );
    return result.json();
  };
  try {
    expect(
      await Promise.all(
        Array.from({ length: 8 }, () => evaluate(recorder.bootstrap.url)),
      ),
    ).toEqual(Array.from({ length: 8 }, () => ({ enabled: true })));
    enabled = false;
    expect(await evaluate(recorder.bootstrap.url)).toEqual({ enabled: true });
    expect(calls).toBe(1);
    const snapshot = await recorder.retain();
    await upstream.stop(true);
    await recorder.stop();
    const replay = await localRollout({ snapshot, store, cache }, loopback);
    try {
      expect(await evaluate(replay.bootstrap.url)).toEqual({ enabled: true });
    } finally {
      await replay.stop();
    }
  } finally {
    await upstream.stop(true);
    await recorder.stop();
    await rm(cache, { recursive: true });
  }
});

it("admits local readers only on disposable map servers and rejects arbitrary HTTP endpoints", () => {
  const base = {
    profile: "storm-dev",
    world: "real-map",
    provider: "docker",
    mapDirectory: "/fixture",
    mapSpawn: [0, 64, 0],
    ttlSeconds: 60,
    keep: false,
  };
  expect(
    SandboxCreateRequestSchema.safeParse({
      ...base,
      rollout: {
        url: "http://host.docker.internal:12345",
        environment: "prod",
      },
    }).success,
  ).toBe(true);
  expect(
    SandboxCreateRequestSchema.safeParse({
      ...base,
      rollout: { url: "http://untrusted.example", environment: "prod" },
    }).success,
  ).toBe(false);
  expect(
    SandboxCreateRequestSchema.safeParse({
      ...base,
      world: "flat",
      rollout: {
        url: "http://host.docker.internal:12345",
        environment: "prod",
      },
    }).success,
  ).toBe(false);
});
