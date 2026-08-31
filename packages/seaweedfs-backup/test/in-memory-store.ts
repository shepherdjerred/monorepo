import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import type {
  GetObjectConditions,
  ListedObject,
  ObjectStore,
  PutObjectInput,
  StoredObject,
} from "@shepherdjerred/seaweedfs-backup/store";
import type { ObjectHeaders } from "@shepherdjerred/seaweedfs-backup/schemas";

type MemoryObject = {
  bytes: Uint8Array;
  etag: string;
  lastModified: Date;
  headers: ObjectHeaders;
};

async function readBody(body: Readable | Uint8Array): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return body;
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) {
    if (typeof chunk === "string") chunks.push(new TextEncoder().encode(chunk));
    else if (chunk instanceof Uint8Array) chunks.push(chunk);
    else throw new Error("Unsupported in-memory stream chunk");
  }
  const result = new Uint8Array(
    chunks.reduce((total, chunk) => total + chunk.byteLength, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export class InMemoryObjectStore implements ObjectStore {
  private readonly buckets = new Map<string, Map<string, MemoryObject>>();
  public corruptWrites = false;
  public failPutPrefix: string | undefined;

  public createBucket(name: string): void {
    this.buckets.set(name, new Map());
  }

  public seed(
    bucket: string,
    key: string,
    value: string,
    lastModified = new Date("2026-08-01T00:00:00.000Z"),
  ): void {
    const bytes = new TextEncoder().encode(value);
    this.requireBucket(bucket).set(key, {
      bytes,
      etag: `"${createHash("md5").update(bytes).digest("hex")}"`,
      lastModified,
      headers: { contentType: "text/plain", metadata: { fixture: "true" } },
    });
  }

  public listBuckets(): Promise<string[]> {
    return Promise.resolve([...this.buckets.keys()]);
  }

  public listObjects(bucket: string, prefix = ""): Promise<ListedObject[]> {
    return Promise.resolve(
      [...this.requireBucket(bucket).entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, object]) => ({
          key,
          size: object.bytes.byteLength,
          etag: object.etag,
          lastModified: object.lastModified,
        })),
    );
  }

  public getObject(
    bucket: string,
    key: string,
    conditions: GetObjectConditions = {},
  ): Promise<StoredObject> {
    const object = this.requireObject(bucket, key);
    if (conditions.etag !== undefined && conditions.etag !== object.etag) {
      throw new Error("PreconditionFailed");
    }
    if (
      conditions.unmodifiedSince !== undefined &&
      object.lastModified.getTime() > conditions.unmodifiedSince.getTime()
    ) {
      throw new Error("PreconditionFailed");
    }
    return Promise.resolve({
      key,
      size: object.bytes.byteLength,
      etag: object.etag,
      lastModified: object.lastModified,
      body: Readable.from([object.bytes]),
      headers: object.headers,
    });
  }

  public headObject(
    bucket: string,
    key: string,
  ): Promise<ListedObject | undefined> {
    const object = this.requireBucket(bucket).get(key);
    return Promise.resolve(
      object === undefined
        ? undefined
        : {
            key,
            size: object.bytes.byteLength,
            etag: object.etag,
            lastModified: object.lastModified,
          },
    );
  }

  public async putObject(input: PutObjectInput): Promise<void> {
    if (
      this.failPutPrefix !== undefined &&
      input.key.startsWith(this.failPutPrefix)
    ) {
      throw new Error(`Injected put failure for ${this.failPutPrefix}`);
    }
    const body = await readBody(input.body);
    const bytes = this.corruptWrites
      ? new TextEncoder().encode("corrupt")
      : body;
    this.requireBucket(input.bucket).set(input.key, {
      bytes,
      etag: `"${createHash("md5").update(bytes).digest("hex")}"`,
      lastModified: new Date(),
      headers: input.headers,
    });
  }

  public deleteObject(bucket: string, key: string): Promise<void> {
    this.requireBucket(bucket).delete(key);
    return Promise.resolve();
  }

  private requireBucket(name: string): Map<string, MemoryObject> {
    const bucket = this.buckets.get(name);
    if (bucket === undefined) throw new Error(`Missing test bucket ${name}`);
    return bucket;
  }

  private requireObject(bucket: string, key: string): MemoryObject {
    const object = this.requireBucket(bucket).get(key);
    if (object === undefined) throw new Error(`NoSuchKey: ${bucket}/${key}`);
    return object;
  }
}
