import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { Serializer } from "../serialization/serializer";
import { Storage } from "./storage";

export class S3Storage<V> implements Storage<V> {
  readonly client: S3Client;
  readonly bucket: string;
  readonly serializer: Serializer<V>;

  constructor(region: string, bucket: string, serializer: Serializer<V>) {
    this.client = new S3Client({
      region,
    });
    this.bucket = bucket;
    this.serializer = serializer;
  }

  async set(key: string, value: V): Promise<undefined> {
    const serializedValue = this.serializer.serialize(value);
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: serializedValue,
    });
    try {
      await this.client.send(command);
      return Promise.resolve(undefined);
    } catch (exception: unknown) {
      return Promise.reject(exception);
    }
  }

  async get(key: string): Promise<V> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    try {
      const result = await this.client.send(command);
      const deserializedValue = this.serializer.deserialize(
        result.Body as string,
      );
      return Promise.resolve(deserializedValue);
    } catch (exception: unknown) {
      return Promise.reject(exception);
    }
  }
}
