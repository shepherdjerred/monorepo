import { z } from "zod";
import { WorkerBuildIdSchema } from "#shared/temporal-bootstrap.ts";

export const DeploymentNameSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,125}[a-z0-9])?$/);
const TimestampSchema = z.iso.datetime({ offset: true });
const RoutingSchema = z.object({
  currentVersionBuildID: z.string(),
  rampingVersionBuildID: z.string(),
  rampingVersionPercentage: z.number().min(0).max(100),
  currentVersionChangedTime: TimestampSchema,
  rampingVersionChangedTime: TimestampSchema,
  rampingVersionPercentageChangedTime: TimestampSchema,
});
export const DeploymentDescriptionSchema = z.object({
  name: DeploymentNameSchema,
  routingConfig: RoutingSchema,
  versionSummaries: z.array(
    z.object({ BuildID: WorkerBuildIdSchema, createTime: TimestampSchema }),
  ),
});
export const VersionDescriptionSchema = z.object({
  BuildID: WorkerBuildIdSchema,
  taskQueuesInfos: z.array(
    z.object({
      name: z.string().min(1),
      type: z.enum(["workflow", "activity", "nexus"]),
    }),
  ),
});
