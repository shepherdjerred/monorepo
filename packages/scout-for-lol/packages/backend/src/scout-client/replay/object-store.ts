import { open } from "node:fs/promises";
import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";

/** Use a Node stream: the SDK's streaming signer does not accept Bun's Blob. */
export async function persistReplayFile(
  client: Pick<S3Client, "send">,
  input: {
    readonly bucket: string;
    readonly key: string;
    readonly path: string;
    readonly bytes: number;
    readonly digest: string;
    readonly gameId: string;
  },
): Promise<void> {
  const file = await open(input.path, "r");
  const body = file.createReadStream({ autoClose: false });
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
        Body: body,
        ContentLength: input.bytes,
        ContentType: "application/vnd.riot.rofl",
        Metadata: {
          sha256: input.digest,
          gameid: input.gameId,
          source: "scout-client",
        },
      }),
    );
  } finally {
    body.destroy();
    await file.close();
  }
}
