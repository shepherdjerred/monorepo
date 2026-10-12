import { expect, it } from "vitest";
import fixture from "./fixtures/minecraft-status.json";
import {
  MinecraftStatusSchema,
  parseMinecraftStatusCache,
} from "#src/minecraft-cache.ts";

const states = ["sleeping", "starting", "online", "unavailable"] as const;
const validStateTriples = new Set([
  "sleeping/sleeping/sleeping",
  "starting/starting/starting",
  "unavailable/unavailable/unavailable",
  "online/online/online",
  "online/online/unavailable",
  "online/unavailable/online",
]);
const stateCases = states.flatMap((state) =>
  states.flatMap((javaState) =>
    states.map((bedrockState) => ({ state, javaState, bedrockState })),
  ),
);

it.each(stateCases)(
  "migrates only valid v2 $state/$javaState/$bedrockState aggregate health",
  ({ state, javaState, bedrockState }) => {
    const value = {
      schemaVersion: 2,
      state,
      checkedAt: fixture.checkedAt,
      java: { ...fixture.java, state: javaState },
      bedrock: { ...fixture.bedrock, state: bedrockState },
      ...(javaState === "online"
        ? {
            players: {
              maximum: fixture.players.maximum,
              names: fixture.players.names,
            },
          }
        : {}),
    };
    if (!validStateTriples.has([state, javaState, bedrockState].join("/"))) {
      expect(() => parseMinecraftStatusCache(value)).toThrow();
      return;
    }
    const result = parseMinecraftStatusCache(value);
    expect(MinecraftStatusSchema.safeParse(result).success).toBe(true);
    expect(result?.players).toBeUndefined();
    expect(result?.games).toBeUndefined();
    expect(result?.java).toEqual({
      ...value.java,
      state: javaState === "online" ? "unavailable" : javaState,
    });
  },
);

it.each(stateCases)(
  "validates $state/$javaState/$bedrockState aggregate health",
  ({ state, javaState, bedrockState }) => {
    const { players, games, ...base } = fixture;
    const value = {
      ...base,
      state,
      java: { ...fixture.java, state: javaState },
      bedrock: { ...fixture.bedrock, state: bedrockState },
      ...(javaState === "online" ? { players, games } : {}),
    };
    expect(MinecraftStatusSchema.safeParse(value).success).toBe(
      validStateTriples.has([state, javaState, bedrockState].join("/")),
    );
  },
);
