import { it, expect } from "vitest";
import { deflateSync, gzipSync } from "node:zlib";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  retainFixture,
  restoreFixture,
  localFixtureSource,
} from "#src/capture/suite/fixture.ts";
import type { BlobStore } from "#src/capture/suite/store.ts";

function integer(name: string, value: number) {
  const bytes = Buffer.alloc(7 + name.length);
  bytes[0] = 3;
  bytes.writeUInt16BE(name.length, 1);
  bytes.write(name, 3);
  bytes.writeInt32BE(value, 3 + name.length);
  return bytes;
}

async function terrain(root: string) {
  for (const [rx, rz] of [
    [-1, -1],
    [-1, 0],
    [0, -1],
    [0, 0],
  ] as const) {
    const header = Buffer.alloc(8192),
      records = [header];
    let sector = 2;
    for (let x = -2; x <= 2; x++)
      for (let z = -2; z <= 2; z++) {
        if (Math.floor(x / 32) !== rx || Math.floor(z / 32) !== rz) continue;
        const index = (((x % 32) + 32) % 32) + (((z % 32) + 32) % 32) * 32;
        const nbt = Buffer.concat([
          Buffer.from([10, 0, 0]),
          integer("DataVersion", 5000),
          integer("xPos", x),
          integer("zPos", z),
          Buffer.from([0]),
        ]);
        const payload = deflateSync(nbt),
          record = Buffer.alloc(4096);
        record.writeUInt32BE(payload.length + 1);
        record[4] = 2;
        payload.copy(record, 5);
        header.writeUInt32BE(sector * 256 + 1, index * 4);
        records.push(record);
        sector++;
      }
    await Bun.write(
      path.join(
        root,
        `dimensions/minecraft/overworld/region/r.${rx.toString()}.${rz.toString()}.mca`,
      ),
      Buffer.concat(records),
    );
  }
}

it("round-trips padded native terrain, dimension settings and datapacks without player data", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "suite-fixture-"));
  const source = path.join(root, "source"),
    cache = path.join(root, "cache"),
    destination = path.join(root, "restored");
  const objects = new Map<string, Uint8Array>();
  const store: BlobStore = {
    write: (key, bytes) => {
      objects.set(key, bytes);
      return Promise.resolve();
    },
    read: (key) => {
      const bytes = objects.get(key);
      if (bytes === undefined) throw new Error("Missing blob");
      return Promise.resolve(bytes);
    },
  };
  const settings = gzipSync(Buffer.from([10, 0, 0, 0]));
  try {
    await terrain(source);
    for (const file of [
      "level.dat",
      "dimensions/minecraft/overworld/data/minecraft/world_gen_settings.dat",
      "dimensions/minecraft/creative/data/minecraft/game_rules.dat",
    ])
      await Bun.write(path.join(source, file), settings);
    await Bun.write(
      path.join(source, "datapacks/example/pack.mcmeta"),
      '{"pack":{"description":"retained"}}',
    );
    await Bun.write(path.join(source, "playerdata/private.dat"), "private");
    const hash = await retainFixture(
      localFixtureSource(source),
      [{ world: "world", min: [0, 0], max: [0, 0], paddingChunks: 2 }],
      store,
    );
    await restoreFixture(store, cache, hash, destination);
    expect(
      new Uint8Array(
        await Bun.file(
          path.join(
            destination,
            "dimensions/minecraft/overworld/data/minecraft/world_gen_settings.dat",
          ),
        ).arrayBuffer(),
      ),
    ).toEqual(new Uint8Array(settings));
    expect(
      await Bun.file(
        path.join(destination, "datapacks/example/pack.mcmeta"),
      ).text(),
    ).toContain("retained");
    expect(
      await Bun.file(path.join(destination, "playerdata/private.dat")).exists(),
    ).toBe(false);
    expect(
      await Bun.file(
        path.join(
          destination,
          "dimensions/minecraft/creative/data/minecraft/game_rules.dat",
        ),
      ).exists(),
    ).toBe(false);
    await rm(
      path.join(source, "dimensions/minecraft/overworld/region/r.-1.-1.mca"),
    );
    await expect(
      retainFixture(
        localFixtureSource(source),
        [{ world: "world", min: [0, 0], max: [0, 0], paddingChunks: 2 }],
        store,
      ),
    ).rejects.toThrow("Missing saved terrain");
  } finally {
    await rm(root, { recursive: true });
  }
});

it("rejects linked ancestors even when the final source file is regular", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "suite-fixture-link-"));
  try {
    await mkdir(path.join(root, "source"));
    await mkdir(path.join(root, "outside"));
    await Bun.write(
      path.join(root, "outside/minecraft/overworld/region/r.0.0.mca"),
      "outside",
    );
    await symlink(
      path.join(root, "outside"),
      path.join(root, "source/dimensions"),
    );
    await expect(
      localFixtureSource(path.join(root, "source")).read(
        "dimensions/minecraft/overworld/region/r.0.0.mca",
      ),
    ).rejects.toThrow("Linked fixture path");
  } finally {
    await rm(root, { recursive: true });
  }
});
