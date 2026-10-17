import {
  dispatchPendingDeliveries,
  qualifyDeliveryBuilds,
} from "./dispatch.ts";
import {
  prepareDelivery,
  applyDelivery,
  verifyDelivery,
  finishDelivery,
} from "./execute.ts";
import { prepareDeliveryWorker, stepDeliveryWorker } from "./worker-rollout.ts";

export const deliveryActivities = {
  prepareDeliveryWorker,
  stepDeliveryWorker,
  dispatchPendingDeliveries,
  qualifyDeliveryBuilds,
  prepareDelivery,
  applyDelivery,
  verifyDelivery,
  finishDelivery,
};
export type DeliveryActivities = typeof deliveryActivities;
