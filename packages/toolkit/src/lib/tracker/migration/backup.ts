import {
  GetObjectCommand,
  PutObjectCommand,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import path from "node:path";
import { createS3Client } from "#lib/s3/client.ts";
import { hash, readExportFile } from "./files.ts";
import { loadExport } from "./runner.ts";

/** Immutable, private archive with byte readback before allowing retirement. */
export async function backupExport(directory: string, profile: string) {
  const snapshot = await loadExport(directory);
  const manifest = await Bun.file(path.join(directory, "export.json")).bytes();
  const prefix =
    "import/" +
    snapshot.exportedAt.replaceAll(":", "-") +
    "/" +
    hash(manifest) +
    "/";
  const bucket = "tracker-attachments";
  const client = createS3Client(profile);
  const objects = [
    { name: "export.json", bytes: manifest, contentType: "application/json" },
    {
      name: "export.sha256",
      bytes: new TextEncoder().encode(hash(manifest) + "\n"),
      contentType: "text/plain",
    },
  ];
  for (const file of snapshot.files)
    objects.push({
      name: file.path,
      bytes: await readExportFile(directory, file),
      contentType: file.contentType,
    });
  const unique = new Map(objects.map((object) => [object.name, object]));
  try {
    for (const object of unique.values()) {
      const key = prefix + object.name;
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: object.bytes,
            ContentType: object.contentType,
            IfNoneMatch: "*",
            Metadata: { sha256: hash(object.bytes) },
          }),
        );
      } catch (error) {
        if (
          !(error instanceof S3ServiceException) ||
          error.$metadata.httpStatusCode !== 412
        )
          throw error;
      }
      const saved = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      if (saved.Body === undefined)
        throw new Error("Archived export has no body");
      const bytes = await saved.Body.transformToByteArray();
      if (
        bytes.length !== object.bytes.length ||
        hash(bytes) !== hash(object.bytes)
      )
        throw new Error("Archived export readback checksum mismatch");
    }
  } finally {
    client.destroy();
  }
  return {
    archive: "s3://" + bucket + "/" + prefix,
    verifiedObjects: unique.size,
  };
}
