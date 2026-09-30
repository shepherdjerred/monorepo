import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";

export const MAX_SESSION_OBJECT_BYTES = 2 * 1024 * 1024;
export type AgentChatObjectStore = {
  create: (key: string, body: Uint8Array) => Promise<boolean>;
  delete: (key: string) => Promise<void>;
  get: (key: string) => Promise<Uint8Array>;
  has: (key: string) => Promise<boolean>;
  put: (key: string, body: Uint8Array) => Promise<void>;
};

export function createAgentChatS3Store(input: {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}): AgentChatObjectStore {
  const client = new S3Client({
    endpoint: input.endpoint,
    region: input.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
    },
  });
  return {
    create: async (key, body) => {
      if (body.byteLength > MAX_SESSION_OBJECT_BYTES)
        throw new Error("Session object exceeds the upload limit");
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: input.bucket,
            Key: key,
            Body: body,
            IfNoneMatch: "*",
          }),
        );
        return true;
      } catch (error: unknown) {
        if (
          error instanceof S3ServiceException &&
          (error.$metadata.httpStatusCode === 409 ||
            error.$metadata.httpStatusCode === 412)
        ) {
          return false;
        }
        throw error;
      }
    },
    delete: async (key) => {
      await client.send(
        new DeleteObjectCommand({ Bucket: input.bucket, Key: key }),
      );
    },
    has: async (key) => {
      try {
        await client.send(
          new HeadObjectCommand({ Bucket: input.bucket, Key: key }),
        );
        return true;
      } catch (error: unknown) {
        if (
          error instanceof S3ServiceException &&
          error.$metadata.httpStatusCode === 404
        )
          return false;
        throw error;
      }
    },
    get: async (key) => {
      const response = await client.send(
        new GetObjectCommand({ Bucket: input.bucket, Key: key }),
      );
      if (response.Body === undefined)
        throw new Error(`Empty session object: ${key}`);
      if ((response.ContentLength ?? 0) > MAX_SESSION_OBJECT_BYTES)
        throw new Error("Session object exceeds the download limit");
      const reader = response.Body.transformToWebStream().getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const result = await reader.read();
          if (result.done) break;
          const value: unknown = result.value;
          if (!(value instanceof Uint8Array))
            throw new Error("Session object stream returned non-binary data");
          length += value.byteLength;
          if (length > MAX_SESSION_OBJECT_BYTES)
            throw new Error("Session object exceeds the download limit");
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      return Buffer.concat(chunks, length);
    },
    put: async (key, body) => {
      if (body.byteLength > MAX_SESSION_OBJECT_BYTES)
        throw new Error("Session object exceeds the upload limit");
      await client.send(
        new PutObjectCommand({ Bucket: input.bucket, Key: key, Body: body }),
      );
    },
  };
}
