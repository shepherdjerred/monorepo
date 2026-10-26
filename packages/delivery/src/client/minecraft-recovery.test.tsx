import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PipelineDefinitionSchema } from "#shared/contract.ts";
import { MinecraftRecovery } from "./minecraft-recovery.tsx";

test.each([undefined, "verified-restore", "retained-volume-restart"] as const)(
  "Minecraft recovery instructions match frozen release mode %s",
  async (releaseMode) => {
    const definition = PipelineDefinitionSchema.parse(
      await Bun.file(
        new URL(
          "../../registrations/specialized/minecraft-tsmc/pipeline.json",
          import.meta.url,
        ),
      ).json(),
    );
    if (definition.kind !== "argocd" || !definition.minecraftUpgrade)
      throw new Error("Expected the Minecraft policy");
    if (releaseMode === undefined)
      delete definition.minecraftUpgrade.releaseMode;
    else definition.minecraftUpgrade.releaseMode = releaseMode;
    const html = renderToStaticMarkup(
      <MinecraftRecovery
        detail={{
          pipeline: { definition },
          deployment: { id: "minecraft/failed", recoveryRequired: true },
          environment: { generation: 4 },
          stages: [],
          minecraftRecoveries: [],
        }}
      />,
    );
    expect(html).toBe("");
  },
);
