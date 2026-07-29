import { GetObjectCommand } from "@aws-sdk/client-s3";
import {
  classicFontManifest,
  configureClassicGillSansFonts,
} from "@scout-for-lol/report";
import { createS3Client } from "#src/storage/s3-client.ts";

let configured = false;
let configurationPromise: Promise<void> | undefined;

function verifySha256(
  bytes: Uint8Array,
  expected: string,
  description: string,
): void {
  const actual = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  if (actual !== expected) {
    throw new Error(
      `${description} checksum mismatch: expected ${expected}, received ${actual}`,
    );
  }
}

async function readPrivateFont(key: string): Promise<Uint8Array> {
  const client = createS3Client();
  const response = await client.send(
    new GetObjectCommand({
      Bucket: classicFontManifest.privateBucket,
      Key: key,
    }),
  );
  if (response.Body === undefined) {
    throw new Error(
      `Private Classic font object has no body: s3://${classicFontManifest.privateBucket}/${key}`,
    );
  }
  return response.Body.transformToByteArray();
}

async function configureFromPrivateStorage(): Promise<void> {
  const localRegularPath = Bun.env["SCOUT_CLASSIC_GILL_SANS_REGULAR_PATH"];
  const localBoldPath = Bun.env["SCOUT_CLASSIC_GILL_SANS_BOLD_PATH"];
  const [regularBytes, boldBytes] =
    localRegularPath !== undefined && localBoldPath !== undefined
      ? await Promise.all([
          Bun.file(localRegularPath).bytes(),
          Bun.file(localBoldPath).bytes(),
        ])
      : await Promise.all([
          readPrivateFont(classicFontManifest.gillSans.regular.key),
          readPrivateFont(classicFontManifest.gillSans.bold.key),
        ]);

  verifySha256(
    regularBytes,
    classicFontManifest.gillSans.regular.sha256,
    "Gill Sans Regular",
  );
  verifySha256(
    boldBytes,
    classicFontManifest.gillSans.bold.sha256,
    "Gill Sans Bold",
  );

  configureClassicGillSansFonts({
    regular: new Uint8Array(regularBytes).buffer,
    bold: new Uint8Array(boldBytes).buffer,
  });
  configured = true;
}

export async function ensureClassicFontsConfigured(): Promise<void> {
  if (configured) {
    return;
  }
  configurationPromise ??= configureFromPrivateStorage();
  await configurationPromise;
}
