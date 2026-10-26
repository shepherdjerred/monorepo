import { expect, test } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { testOperator } from "#testing/seed.ts";

const context = useDeliveryFixture();

test("new Minecraft recovery requests are refused", () => {
  expect(() =>
    context.delivery.requestMinecraftRecovery(
      "deployment/missing",
      {
        requestId: "minecraft/recover",
        expectedEnvironmentGeneration: 1,
        reason: "Releases restart the retained volume",
      },
      testOperator,
    ),
  ).toThrow(
    "Minecraft recovery was removed. Releases restart the retained volume. Scheduled Velero backups are the only backup.",
  );
});
