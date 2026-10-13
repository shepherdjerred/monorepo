import { S3Client } from "bun";
import type { ObjectStore } from "#application/object-store.ts";
import type { Bootstrap } from "./config.ts";

export function createObjectStore(config: Bootstrap): ObjectStore {
  const client = new S3Client({
    endpoint: config.S3_ENDPOINT,
    bucket: config.S3_BUCKET,
    region: config.S3_REGION,
    accessKeyId: config.AWS_ACCESS_KEY_ID,
    secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
  });
  return {
    async put(key, body, contentType) {
      await client.file(key).write(new Response(body), { type: contentType });
    },
    get: (key) => client.file(key).stream(),
    async delete(key) {
      await client.file(key).delete();
    },
  };
}
