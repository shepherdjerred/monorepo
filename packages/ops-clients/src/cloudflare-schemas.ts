import { z } from "zod";

export const CfErrorItemSchema = z.object({
  message: z.string().optional(),
});

export const CfResultInfoSchema = z
  .object({
    page: z.number().int().optional(),
    total_pages: z.number().int().optional(),
  })
  .optional();

export function cfEnvelope<T extends z.ZodType>(resultSchema: T) {
  return z.object({
    success: z.boolean(),
    errors: z.array(CfErrorItemSchema).default([]),
    result: resultSchema.nullable().optional(),
    result_info: CfResultInfoSchema,
  });
}

export const RawZoneSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.string(),
  paused: z.boolean().default(false),
  plan: z.object({ name: z.string().optional() }).optional(),
  name_servers: z.array(z.string()).default([]),
});

export const RawDnssecSchema = z.object({
  status: z.string().nullable().optional(),
});

export const RawDnsRecordSchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  content: z.string(),
});

export const RawR2BucketSchema = z.object({
  name: z.string().min(1),
  creation_date: z.string().optional(),
  location: z.string().optional(),
});

export const R2ListResultSchema = z.union([
  z.object({ buckets: z.array(RawR2BucketSchema) }),
  z.array(RawR2BucketSchema),
]);

export const R2GraphqlSchema = z.object({
  viewer: z
    .object({
      accounts: z.array(
        z.object({
          r2StorageAdaptiveGroups: z.array(
            z.object({
              dimensions: z.object({ bucketName: z.string() }),
              max: z.object({
                payloadSize: z.number().nullable().optional(),
                metadataSize: z.number().nullable().optional(),
                objectCount: z.number().nullable().optional(),
              }),
            }),
          ),
        }),
      ),
    })
    .nullable(),
});

export const RawTunnelSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  status: z.string().default("unknown"),
  connections: z
    .array(z.object({ colo_name: z.string().optional() }))
    .default([]),
});

export const RawTunnelConfigSchema = z.object({
  config: z
    .object({
      ingress: z
        .array(
          z.object({
            hostname: z.string().optional(),
            path: z.string().optional(),
            service: z.string(),
          }),
        )
        .optional(),
    })
    .nullable()
    .optional(),
});

export const RdapDomainSchema = z
  .object({
    events: z
      .array(
        z
          .object({
            eventAction: z.string(),
            eventDate: z.string(),
          })
          .loose(),
      )
      .optional(),
  })
  .loose();

export const R2_STORAGE_QUERY = `
query R2Storage($accountTag: string!, $since: Time!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      r2StorageAdaptiveGroups(limit: 1000, filter: { datetime_geq: $since }) {
        dimensions { bucketName }
        max { payloadSize metadataSize objectCount }
      }
    }
  }
}`;
