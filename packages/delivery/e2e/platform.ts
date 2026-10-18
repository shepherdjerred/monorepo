import type { Database } from "#infrastructure/database.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { controlPlaneFixture } from "#testing/control-plane-fixture.ts";
import {
  requestTestPlan,
  checkpointTestPlan,
  testNativeReceipt,
} from "#testing/platform-execution.ts";
import { testExecutor, testOperator } from "#testing/seed.ts";

export async function seedPlatformBrowser(
  database: Database,
  delivery: Delivery,
  sourceBuildId: string,
) {
  const controller = await controlPlaneFixture(database);
  await controller.delivery.requestControlPlaneUpgrade(
    controller.environment.id,
    controller.input,
    testOperator,
  );
  for (const stack of ["anthropic", "discord"]) {
    const deployment = await requestTestPlan(delivery, sourceBuildId, stack);
    const saved = await checkpointTestPlan(delivery, deployment);
    await delivery.finish(
      deployment.id,
      {
        status: "failed",
        message: "Saved native apply response requires independent inspection",
        recoveryRequired: true,
        evidence: [],
      },
      testExecutor,
    );
    const env = await database.environment.findUniqueOrThrow({
      where: { id: deployment.environmentId },
    });
    const intent = await delivery.requestPlatformRecovery(
      deployment.id,
      {
        requestId: `browser/recovery/${stack}`,
        expectedEnvironmentGeneration: env.generation,
        reason:
          "Review exact independent recovery plan, original source and held state",
      },
      testOperator,
    );
    const native = {
      ...testNativeReceipt(intent.id),
      name: `delivery-${(stack === "anthropic" ? "d" : "e").repeat(40)}`,
    };
    await delivery.recordPlatformRecoveryNative(
      intent.id,
      { action: "plan", receipt: native },
      testExecutor,
    );
    const { deploymentId: _id, schema: _schema, ...fields } = saved.receipt;
    await delivery.recordPlatformRecoveryPlan(
      intent.id,
      {
        receipt: {
          ...fields,
          schema: "delivery-tofu-recovery-plan/v1",
          recoveryIntentId: intent.id,
          nativeJob: native,
        },
        encryptedPlan: saved.encryptedPlan,
      },
      testExecutor,
    );
  }
}
