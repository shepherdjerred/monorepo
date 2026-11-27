import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createOpener } from "@shepherdjerred/toolkit/lib/brim/sync/crypto.ts";
import { createS3ObjectStore } from "@shepherdjerred/toolkit/lib/brim/sync/object-store.ts";
import { z } from "zod";
import { openBrimArchive } from "./archive.ts";
import { createBrimApp } from "./server.ts";
import { BrimStore } from "./store.ts";

const env = z
  .object({
    HOST: z.string().default("0.0.0.0"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(7458),
    BRIM_DATA_DIR: z.string().min(1),
    BRIM_ARCHIVE_DIR: z.string().min(1),
    BRIM_HUB_TOKEN: z.string().min(1),
    BRIM_DEVICE_TOKEN: z.string().min(1),
    BRIM_MACBOOK_PUBLISH_TOKEN: z.string().min(1),
    BRIM_SCHEDULER_TOKEN: z.string().min(1),
    BRIM_SYNC_AGE_IDENTITY: z.string().min(1),
    AWS_ENDPOINT_URL_S3: z.url(),
    AWS_REGION: z.string().min(1),
    AWS_ACCESS_KEY_ID: z.string().min(1),
    AWS_SECRET_ACCESS_KEY: z.string().min(1),
  })
  .parse(Bun.env);

await mkdir(env.BRIM_DATA_DIR, { recursive: true, mode: 0o700 });
const store = new BrimStore(path.join(env.BRIM_DATA_DIR, "brim.sqlite"));
const archive = await openBrimArchive({
  home: env.BRIM_ARCHIVE_DIR,
  store: createS3ObjectStore({
    bucket: "brim-sessions",
    profile: "",
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  }),
  open: createOpener(env.BRIM_SYNC_AGE_IDENTITY),
  loadQuotaSnapshots: () => Promise.resolve(store.freshSnapshots()),
});
const app = createBrimApp({
  store,
  tokens: {
    hub: env.BRIM_HUB_TOKEN,
    device: env.BRIM_DEVICE_TOKEN,
    macbook: env.BRIM_MACBOOK_PUBLISH_TOKEN,
    scheduler: env.BRIM_SCHEDULER_TOKEN,
  },
  history: archive.read,
  archiveStatus: archive.status,
  syncArchive: archive.refresh,
});
const server = Bun.serve({
  port: env.PORT,
  hostname: env.HOST,
  maxRequestBodySize: 8 * 1024 * 1024,
  fetch(request, listener) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/metrics") {
      const lastSuccess = archive.status().lastSuccessfulSyncAt;
      const seconds = lastSuccess === null ? 0 : Date.parse(lastSuccess) / 1000;
      return new Response(
        `# TYPE brim_archive_last_success_timestamp_seconds gauge\nbrim_archive_last_success_timestamp_seconds ${String(seconds)}\n`,
        {
          headers: { "Content-Type": "text/plain; version=0.0.4" },
        },
      );
    }
    if (url.pathname === "/internal/v1/sync") listener.timeout(request, 0);
    return app(request);
  },
});
console.warn(`Brim listening on port ${String(server.port)}`);
