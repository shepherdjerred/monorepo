import { createTestDatabase as createCluster } from "./postgres.ts";
import {
  seedDelivery as seed,
  testOperator as operator,
  testPublisher as publisher,
  testExecutor as executor,
} from "./seed.ts";
import { Delivery as Store } from "#infrastructure/delivery.ts";
import { createApp as app } from "#server/app.ts";
import { createRecoveryInspector as recoveryInspector } from "#infrastructure/recovery.ts";

export const createTestDatabase = () => createCluster();
export const seedDelivery = (delivery: Store) => seed(delivery);
export const testOperator = { ...operator };
export const testPublisher = { ...publisher };
export const testExecutor = { ...executor };
export class Delivery extends Store {}
export const createApp = (options: Parameters<typeof app>[0]) => app(options);
export const createRecoveryInspector = (
  options: Parameters<typeof recoveryInspector>[0],
) => recoveryInspector(options);
