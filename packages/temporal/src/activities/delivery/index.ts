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
import {
  prepareDeliveryWorker,
  stepDeliveryWorker,
  inspectDeliveryWorkerImages,
} from "./workers/worker-rollout.ts";
import {
  inspectDeliveryWorkerRecovery,
  failDeliveryWorkerRecovery,
} from "./workers/worker-recovery.ts";
import { dispatchDeliveryWorkerRecoveries } from "./workers/worker-recovery-dispatch.ts";
import { preserveDeliveryMinecraft } from "./minecraft.ts";
import { applyDeliveryScoutSite } from "./scout-site.ts";
import {
  recoverDeliveryMinecraft,
  failDeliveryMinecraftRecovery,
} from "./minecraft-recovery.ts";
import { dispatchDeliveryMinecraftRecoveries } from "./minecraft-recovery-dispatch.ts";
import {
  qualifyDeliveryForumBundles,
  observeDeliveryForumBaseline,
  failDeliveryForumBaseline,
} from "./forum/operations.ts";
import { dispatchDeliveryForumBaselines } from "./forum/dispatch.ts";
import { applyDeliveryTrmnlPlugins } from "./trmnl.ts";
import {
  listDeliveryReplications,
  recordDeliveryReplication,
} from "./replication/receipts.ts";
import {
  failDeliveryPlatformRecovery,
  dispatchDeliveryPlatformRecoveries,
} from "./platform/recovery.ts";
import { runDeliveryTestStage } from "./test-stage.ts";
import {
  acceptDeliveryModel,
  planDeliveryModel,
  recordDeliveryColdStart,
  renewDeliveryLease,
  runDeliveryModelStep,
  settleDeliveryModel,
} from "./model/steps.ts";
import {
  observeDeliveryDrift,
  observeDeliveryMonitors,
} from "./model/monitor.ts";

export const deliveryActivities = {
  observeDeliveryMonitors,
  observeDeliveryDrift,
  planDeliveryModel,
  renewDeliveryLease,
  runDeliveryModelStep,
  acceptDeliveryModel,
  settleDeliveryModel,
  recordDeliveryColdStart,
  listDeliveryReplications,
  recordDeliveryReplication,
  runDeliveryTestStage,
  applyDeliveryTrmnlPlugins,
  failDeliveryPlatformRecovery,
  dispatchDeliveryPlatformRecoveries,
  qualifyDeliveryForumBundles,
  observeDeliveryForumBaseline,
  failDeliveryForumBaseline,
  dispatchDeliveryForumBaselines,
  recoverDeliveryMinecraft,
  failDeliveryMinecraftRecovery,
  dispatchDeliveryMinecraftRecoveries,
  applyDeliveryScoutSite,
  preserveDeliveryMinecraft,
  inspectDeliveryWorkerRecovery,
  failDeliveryWorkerRecovery,
  dispatchDeliveryWorkerRecoveries,
  inspectDeliveryWorkerImages,
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
