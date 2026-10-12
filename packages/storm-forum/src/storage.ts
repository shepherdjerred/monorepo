import { z } from "zod";

export const RuntimeImageSchema = z
  .string()
  .regex(/^ghcr\.io\/shepherdjerred\/storm-forum@sha256:[a-f0-9]{64}$/);
export const SnapshotSourceSchema = z
  .object({
    bundleSha256: z.string().regex(/^[a-f0-9]{64}$/),
    xenforoVersion: z.string().min(1),
    runtimeImage: RuntimeImageSchema,
  })
  .strict();

export const SnapshotEnvironmentSchema = z.object({
  DB_HOST: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_NAME: z.string().regex(/^\w+$/),
  DB_PASSWORD: z.string().min(1),
  BACKUP_ENDPOINT: z.url(),
  BACKUP_BUCKET: z.string().min(1),
  BACKUP_ACCESS_KEY: z.string().min(1),
  BACKUP_SECRET_KEY: z.string().min(1),
  BUNDLE_SHA256: z.string().regex(/^[a-f0-9]{64}$/),
  RUNTIME_IMAGE: RuntimeImageSchema,
});
