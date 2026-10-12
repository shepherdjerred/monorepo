import { expect, it } from "vitest";
import fixture from "./fixtures/minecraft-status.json";
import { MinecraftStatusSchema } from "#src/minecraft.ts";

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
