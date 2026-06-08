import path from "node:path";
import {
  assetKey,
  assetPublicUrl,
  contentTypeForFile,
  PUBLIC_BUCKET,
} from "#lib/s3/assets.ts";
import { loadS3Credentials, putObject } from "#lib/s3/client.ts";

export type AssetOptions = {
  markdown?: boolean | undefined;
};

const USAGE = "Usage: toolkit pr asset <pr-number> <file...> [--markdown]";

/**
 * Upload one or more files as PR screenshots to the `public-sjer-red` bucket
 * under `pr/assets/<pr-number>/`, printing the public `public.sjer.red` URL for
 * each (or a ready-to-paste markdown image tag with `--markdown`).
 */
export async function assetCommand(
  prNumber: string | undefined,
  files: string[],
  options: AssetOptions,
): Promise<void> {
  const parsed = Number(prNumber);
  if (
    prNumber == null ||
    prNumber.length === 0 ||
    !Number.isInteger(parsed) ||
    parsed <= 0
  ) {
    console.error("Error: a positive integer PR number is required");
    console.error(USAGE);
    process.exit(1);
  }

  if (files.length === 0) {
    console.error("Error: at least one file is required");
    console.error(USAGE);
    process.exit(1);
  }

  const credentials = loadS3Credentials();

  for (const file of files) {
    const bunFile = Bun.file(file);
    if (!(await bunFile.exists())) {
      console.error(`Error: file not found: ${file}`);
      process.exit(1);
    }

    const body = new Uint8Array(await bunFile.arrayBuffer());
    await putObject(credentials, {
      bucket: PUBLIC_BUCKET,
      key: assetKey(parsed, file),
      body,
      contentType: contentTypeForFile(file),
    });

    const url = assetPublicUrl(parsed, file);
    console.log(
      options.markdown === true ? `![${path.basename(file)}](${url})` : url,
    );
  }
}
