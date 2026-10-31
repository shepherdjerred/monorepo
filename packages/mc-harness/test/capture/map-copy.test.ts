import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it, expect } from "vitest";
import { copyRealMap } from "#sandbox/map-copy.ts";
import { SandboxCreateRequestSchema } from "#protocol/ipc.ts";
import { resolveProfile } from "#sandbox/profiles.ts";

it("copies only saved map content and records its identity without changing the source", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mc-map-copy-"));
  try {
    const source = path.join(root, "source");
    await mkdir(path.join(source, "dimensions/minecraft/overworld/region"), {
      recursive: true,
    });
    for (const name of ["data", "datapacks", "players"])
      await mkdir(path.join(source, name));
    await Bun.write(path.join(source, "level.dat"), "test world metadata");
    await Bun.write(
      path.join(source, "dimensions/minecraft/overworld/region/r.0.0.mca"),
      "test region bytes",
    );
    await Bun.write(path.join(source, "players/private.dat"), "private player");
    await Bun.write(path.join(source, "session.lock"), "source session");
    const first = await copyRealMap(source, path.join(root, "first"));
    const second = await copyRealMap(source, path.join(root, "second"));
    expect(first).toEqual(second);
    expect(first.files).toBe(2);
    expect(first.dimensions).toEqual(["minecraft:overworld"]);
    expect(
      await Bun.file(path.join(root, "first/players/private.dat")).exists(),
    ).toBe(false);
    expect(await readFile(path.join(source, "session.lock"), "utf8")).toBe(
      "source session",
    );
    await expect(
      copyRealMap(source, path.join(root, "first")),
    ).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("requires explicit source map and local provider before starting a real-map session", () => {
  const base = {
    profile: "storm-dev",
    world: "real-map",
    ttlSeconds: 3600,
    keep: false,
    mapSpawn: [0.5, 101, 0.5],
  };
  expect(SandboxCreateRequestSchema.safeParse(base).success).toBe(false);
  expect(
    SandboxCreateRequestSchema.safeParse({
      ...base,
      mapDirectory: "/maps/source",
      provider: "kubernetes",
    }).success,
  ).toBe(false);
  expect(
    SandboxCreateRequestSchema.safeParse({
      ...base,
      mapDirectory: "/maps/source",
      provider: "docker",
    }).success,
  ).toBe(true);
  expect(
    SandboxCreateRequestSchema.safeParse({
      ...base,
      world: "void",
      mapDirectory: "/maps/source",
    }).success,
  ).toBe(false);
});

it("uses an explicit real rollout reader without admitting credentials or synthetic-map overrides", () => {
  const request = {
    profile: "storm-dev",
    world: "real-map",
    mapDirectory: "/maps/source",
    mapSpawn: [0.5, 101, 0.5],
    ttlSeconds: 3600,
    keep: false,
    rollout: { url: "https://example.com", environment: "prod" },
  };
  const parsed = SandboxCreateRequestSchema.parse(request);
  const profile = resolveProfile(
    parsed,
    { bridgeToken: "a".repeat(48), rconPassword: "b".repeat(48) },
    { sha256: "c".repeat(64), files: 1, bytes: 1 },
  );
  expect(profile.env["FLIPT_URL"]).toBe(request.rollout.url);
  expect(profile.env["FLIPT_ENVIRONMENT"]).toBe("prod");
  for (const url of [
    "invalid",
    "http://example.com",
    "https://user:secret@example.com",
    "https://example.com?token=secret",
    "https://example.com/token/secret",
  ]) {
    expect(
      SandboxCreateRequestSchema.safeParse({
        ...request,
        rollout: { ...request.rollout, url },
      }).success,
    ).toBe(false);
  }
  expect(
    SandboxCreateRequestSchema.safeParse({
      profile: "storm-dev",
      world: "void",
      ttlSeconds: 3600,
      keep: false,
      rollout: request.rollout,
    }).success,
  ).toBe(false);
});
