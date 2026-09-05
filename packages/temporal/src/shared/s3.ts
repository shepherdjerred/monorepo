import { createSignedS3Request } from "@shepherdjerred/s3-signed-request";

export type S3PutObjectConfig = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string | undefined;
  endpoint: string;
  bucket: string;
  key: string;
  region: string;
  forcePathStyle: boolean;
  contentType: string;
};

export async function putS3Object(
  config: S3PutObjectConfig,
  body: string,
): Promise<void> {
  const request = createSignedS3Request(config, {
    method: "PUT",
    key: config.key,
    body,
    contentType: config.contentType,
  });
  const response = await fetch(request);

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(
      `S3 upload failed (${String(response.status)}): ${responseBody}`,
    );
  }
}
