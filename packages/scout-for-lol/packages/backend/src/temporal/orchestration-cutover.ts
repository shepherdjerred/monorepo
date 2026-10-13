import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  withScoutEffectFence,
  type ScoutEffectFence,
} from "#src/temporal/effect-fence.ts";

const CUTOVER_ID = "scout-temporal-durability-v1";
export type OrchestrationMode = "legacy" | "durable" | "paused";
const producerContext = new AsyncLocalStorage<{
  mode: OrchestrationMode;
  fence: ScoutEffectFence;
}>();
const cutoverEnabled = async () =>
  await isPolicyEnabled("scout_durable_orchestration_enabled");

async function activateCutover(database: ExtendedPrismaClient): Promise<void> {
  await withScoutEffectFence(
    CUTOVER_ID,
    async (fence) => {
      await fence.assertHeld();
      await database.scoutOrchestrationCutover.createMany({
        data: [{ id: CUTOVER_ID }],
        skipDuplicates: true,
      });
    },
    { database },
  );
}

/** Shared leases let producers run concurrently; activation waits for every legacy lease. */
export async function withOrchestrationProducer<T>(
  produce: () => Promise<T>,
  database: ExtendedPrismaClient = prisma,
  enabled: () => Promise<boolean> = cutoverEnabled,
): Promise<T> {
  const current = producerContext.getStore();
  if (current !== undefined) {
    await current.fence.assertHeld();
    return await produce();
  }
  if (await enabled()) {
    const activated = await database.scoutOrchestrationCutover.findUnique({
      where: { id: CUTOVER_ID },
    });
    if (activated === null) await activateCutover(database);
  }
  return await withScoutEffectFence(
    CUTOVER_ID,
    async (fence) => {
      const activated = await database.scoutOrchestrationCutover.findUnique({
        where: { id: CUTOVER_ID },
      });
      // A flag change after acquiring the shared lease takes effect on the next
      // producer. It cannot upgrade this lease while legacy writes are in flight.
      const mode =
        activated === null
          ? "legacy"
          : (await enabled())
            ? "durable"
            : "paused";
      await fence.assertHeld();
      const value = await producerContext.run({ mode, fence }, produce);
      await fence.assertHeld();
      return value;
    },
    { database, shared: true },
  );
}

/** Only producers consult this flag; committed intents and operations keep running. */
export async function orchestrationMode(
  database: ExtendedPrismaClient = prisma,
  enabled: () => Promise<boolean> = cutoverEnabled,
): Promise<OrchestrationMode> {
  const current = producerContext.getStore();
  if (current !== undefined) {
    await current.fence.assertHeld();
    return current.mode;
  }
  if (await enabled()) {
    await activateCutover(database);
    return "durable";
  }
  const activated = await database.scoutOrchestrationCutover.findUnique({
    where: { id: CUTOVER_ID },
  });
  return activated === null ? "legacy" : "paused";
}
