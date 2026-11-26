import { z } from "zod";
import { deliveryTofuGrants } from "homelab/src/delivery-platform-grants.ts";
import {
  deliveryJobArchive,
  type DeliveryJobRequest,
} from "#shared/delivery-job.ts";
import { RecoveryJobInputSchema } from "./platform/recovery/request.ts";

type Grant = { env: string; secret: string; key: string };
export function jobGrants(input: DeliveryJobRequest): Grant[] {
  if (input.recipe === "platform-recovery") {
    const frozen = RecoveryJobInputSchema.parse(input.input);
    return [
      {
        env: "DELIVERY_EXECUTOR_TOKEN",
        secret: "delivery-platform-api",
        key: "DELIVERY_EXECUTOR_TOKEN",
      },
      ...(frozen.target === "tofu"
        ? deliveryTofuGrants(z.string().parse(frozen.stack))
        : [
            {
              env: "ARGOCD_TOKEN",
              secret: "delivery-platform-argocd",
              key: "ARGOCD_TOKEN",
            },
          ]),
      // A model tofu recovery stages its frozen stack archive (X8).
      ...(frozen.archive === undefined ? [] : ARCHIVE_READER_GRANTS),
    ];
  }
  if (
    ["worker-images", "worker-preflight", "worker-step", "test"].includes(
      input.recipe,
    )
  )
    return [];
  if (input.recipe === "control-plane")
    return [
      {
        env: "ARGOCD_TOKEN",
        secret: "delivery-platform-argocd",
        key: "ARGOCD_TOKEN",
      },
      {
        env: "DELIVERY_EXECUTOR_TOKEN",
        secret: "delivery-platform-api",
        key: "DELIVERY_EXECUTOR_TOKEN",
      },
    ];
  const stack = tofuJobStack(input.input);
  return [
    ...deliveryTofuGrants(stack),
    ...(deliveryJobArchive(input) === undefined ? [] : ARCHIVE_READER_GRANTS),
    ...(input.recipe === "tofu-apply"
      ? [
          {
            env: "DELIVERY_EXECUTOR_TOKEN",
            secret: "delivery-platform-api",
            key: "DELIVERY_EXECUTOR_TOKEN",
          },
        ]
      : []),
  ];
}

/** Read-only artifact-store credential; provisioned as a Secret in `delivery-platform-jobs`. */
const ARCHIVE_READER_GRANTS: Grant[] = [
  {
    env: "DELIVERY_ARCHIVE_READER_ACCESS_KEY_ID",
    secret: "delivery-archive-reader",
    key: "DELIVERY_ARCHIVE_READER_ACCESS_KEY_ID",
  },
  {
    env: "DELIVERY_ARCHIVE_READER_SECRET_ACCESS_KEY",
    secret: "delivery-archive-reader",
    key: "DELIVERY_ARCHIVE_READER_SECRET_ACCESS_KEY",
  },
];

/**
 * The stack whose grants a Tofu Job gets. Its input is a v1 frozen snapshot
 * (bare or `{ snapshot, archive }`) or a model step `{ model, archive }`;
 * the Job itself validates the whole input.
 */
function tofuJobStack(input: unknown): string {
  const Stack = z.object({ stack: z.string() }).loose();
  const snapshot = z.object({ snapshot: Stack }).loose().safeParse(input);
  if (snapshot.success) return snapshot.data.snapshot.stack;
  const modelStep = z.object({ model: Stack }).loose().safeParse(input);
  return modelStep.success
    ? modelStep.data.model.stack
    : Stack.parse(input).stack;
}
