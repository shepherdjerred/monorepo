import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";

type ReadS3ObjectParams = {
  client: S3Client;
  bucket: string;
  key: string;
};

async function readS3Body(params: ReadS3ObjectParams) {
  const response = await params.client.send(
    new GetObjectCommand({
      Bucket: params.bucket,
      Key: params.key,
    }),
  );

  if (response.Body === undefined) {
    throw new Error(
      `S3 object has no body: s3://${params.bucket}/${params.key}`,
    );
  }

  return response.Body;
}

export async function readS3ObjectBytes(
  params: ReadS3ObjectParams,
): Promise<Uint8Array> {
  const body = await readS3Body(params);
  return await body.transformToByteArray();
}

export async function readS3ObjectText(
  params: ReadS3ObjectParams,
): Promise<string> {
  const body = await readS3Body(params);
  return await body.transformToString();
}

export async function readS3Json(params: ReadS3ObjectParams): Promise<unknown> {
  const text = await readS3ObjectText(params);
  const parsed: unknown = JSON.parse(text);
  return parsed;
}
