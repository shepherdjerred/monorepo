import { z } from "zod";

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
});
