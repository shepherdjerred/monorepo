import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { createS3Client, type S3StaticCredentials } from "#lib/s3/client.ts";

/**
 * The few object operations `brim sync` needs. Keys are opaque strings; the
 * store never sees plaintext because every body is age-encrypted first.
 */
export type ObjectStore = {
  put: (key: string, body: Uint8Array) => Promise<void>;
  /** Resolves `null` for a missing key; every other failure throws. */
  get: (key: string) => Promise<Uint8Array | null>;
  /** Immediate child "directories" of `prefix`, without the prefix. */
  listChildren: (prefix: string) => Promise<string[]>;
  delete: (key: string) => Promise<void>;
  /** Every key under `prefix`. */
  listKeys: (prefix: string) => Promise<string[]>;
};

export type S3ObjectStoreOptions = {
  readonly bucket: string;
  /** AWS profile carrying the endpoint (and, by default, the scoped key). */
  readonly profile: string;
  /** Keys resolved by the credential broker instead of the profile's file. */
  readonly credentials?: S3StaticCredentials;
};

export function createS3ObjectStore(
  options: S3ObjectStoreOptions,
): ObjectStore {
  const clientPromise = createS3Client(options.profile, options.credentials);
  const Bucket = options.bucket;

  async function list(
    prefix: string,
    delimiter: string | undefined,
  ): Promise<{ keys: string[]; prefixes: string[] }> {
    const client = await clientPromise;
    const keys: string[] = [];
    const prefixes: string[] = [];
    let token: string | undefined;
    do {
      const page = await client.send(
        new ListObjectsV2Command({
          Bucket,
          Prefix: prefix,
          Delimiter: delimiter,
          ContinuationToken: token,
        }),
      );
      for (const entry of page.Contents ?? []) {
        if (entry.Key !== undefined) keys.push(entry.Key);
      }
      for (const entry of page.CommonPrefixes ?? []) {
        if (entry.Prefix !== undefined) prefixes.push(entry.Prefix);
      }
      token =
        page.IsTruncated === true ? page.NextContinuationToken : undefined;
    } while (token !== undefined);
    return { keys, prefixes };
  }

  return {
    put: async (key, body) => {
      const client = await clientPromise;
      await client.send(
        new PutObjectCommand({
          Bucket,
          Key: key,
          Body: body,
          ContentType: "application/octet-stream",
        }),
      );
    },
    get: async (key) => {
      const client = await clientPromise;
      try {
        const response = await client.send(
          new GetObjectCommand({ Bucket, Key: key }),
        );
        if (response.Body === undefined) {
          throw new Error(`S3 returned no body for ${key}`);
        }
        return await response.Body.transformToByteArray();
      } catch (error: unknown) {
        if (error instanceof NoSuchKey) return null;
        throw error;
      }
    },
    listChildren: async (prefix) => {
      const { prefixes } = await list(prefix, "/");
      return prefixes.map((child) =>
        child.slice(prefix.length).replace(/\/$/, ""),
      );
    },
    listKeys: async (prefix) => {
      const { keys } = await list(prefix, undefined);
      return keys;
    },
    delete: async (key) => {
      const client = await clientPromise;
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
  };
}

/** In-memory store for tests and dry runs. */
export function createMemoryObjectStore(): ObjectStore & {
  readonly objects: Map<string, Uint8Array>;
} {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    put: (key, body) => {
      objects.set(key, Uint8Array.from(body));
      return Promise.resolve();
    },
    get: (key) => Promise.resolve(objects.get(key) ?? null),
    listChildren: (prefix) => {
      const children = new Set<string>();
      for (const key of objects.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const slash = rest.indexOf("/");
        if (slash > 0) children.add(rest.slice(0, slash));
      }
      return Promise.resolve([...children].toSorted());
    },
    listKeys: (prefix) =>
      Promise.resolve(
        [...objects.keys()].filter((key) => key.startsWith(prefix)).toSorted(),
      ),
    delete: (key) => {
      objects.delete(key);
      return Promise.resolve();
    },
  };
}
