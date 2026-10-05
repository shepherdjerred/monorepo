import { describe, expect, it } from "vitest";
import { defineConfig } from "@shepherdjerred/config";
import { createEnvSource } from "@shepherdjerred/config/sources/env.ts";
import {
  DEFAULT_PROTECTED_REGIONS,
  liveGuardConfig,
  MC_DAEMON_CONFIG_DEFINITION,
} from "#src/daemon/config.ts";

function configFrom(env: Record<string, string>) {
  return defineConfig({
    definition: MC_DAEMON_CONFIG_DEFINITION,
    sources: { env: createEnvSource(env) },
  });
}

describe("live guard config", () => {
  it("protects the Zombies settlement by default", async () => {
    const guard = await liveGuardConfig(configFrom({}));
    expect(guard.protectedRegions).toEqual(DEFAULT_PROTECTED_REGIONS);
    expect(guard.protectedRegions[0]?.box).toMatchObject({
      world: "world",
      min: { x: 1712, z: 2128 },
      max: { x: 1871, z: 2287 },
    });
  });

  it("reads protected regions as JSON from the environment", async () => {
    const regions = [
      {
        name: "spawn",
        box: {
          world: "world",
          min: { x: -16, y: 60, z: -16 },
          max: { x: 16, y: 90, z: 16 },
        },
      },
    ];
    const guard = await liveGuardConfig(
      configFrom({ MC_LIVE_PROTECTED_REGIONS: JSON.stringify(regions) }),
    );
    expect(guard.protectedRegions).toEqual(regions);
    expect(
      await liveGuardConfig(configFrom({ MC_LIVE_PROTECTED_REGIONS: "[]" })),
    ).toMatchObject({ protectedRegions: [] });
  });

  it("rejects a malformed protected region", async () => {
    await expect(
      liveGuardConfig(
        configFrom({ MC_LIVE_PROTECTED_REGIONS: '[{"name":"x"}]' }),
      ),
    ).rejects.toThrow();
  });
});
