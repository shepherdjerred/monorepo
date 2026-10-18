import { run, runAllowExit, requireEnv } from "../run.ts";
import { SEAWEEDFS_AWS_ENV, SEAWEEDFS_ENDPOINT } from "../seaweedfs.ts";
import { staticArchiveDigest } from "../static-site-archive.ts";

/** Conditional creation plus byte readback survives both retries and lost upload responses. */
export async function publishImmutableArchive(input: {
  uri: string;
  file: string;
  readback: string;
  digest: string;
}): Promise<void> {
  const target = /^s3:\/\/delivery-artifacts\/(.+)$/u.exec(input.uri);
  if (target?.[1] === undefined || !/^sha256:[a-f0-9]{64}$/u.test(input.digest))
    throw new Error("Invalid immutable archive target");
  if (
    !target[1].endsWith(`/${input.digest.slice(7)}.json`) &&
    !target[1].endsWith(`/${input.digest.slice(7)}.tar`)
  )
    throw new Error("Archive key must contain its exact content digest");
  const options = {
    env: {
      ...SEAWEEDFS_AWS_ENV,
      AWS_ACCESS_KEY_ID: requireEnv("DELIVERY_ARCHIVE_PUBLISHER_ACCESS_KEY_ID"),
      AWS_SECRET_ACCESS_KEY: requireEnv(
        "DELIVERY_ARCHIVE_PUBLISHER_SECRET_ACCESS_KEY",
      ),
    },
    unsetEnv: ["OP_SERVICE_ACCOUNT_TOKEN", "AWS_SESSION_TOKEN"],
  };
  const publication = await runAllowExit(
    [
      "aws",
      "s3api",
      "put-object",
      "--bucket",
      "delivery-artifacts",
      "--key",
      target[1],
      "--body",
      input.file,
      "--if-none-match",
      "*",
      "--endpoint-url",
      SEAWEEDFS_ENDPOINT,
      "--no-cli-pager",
    ],
    options,
  );
  try {
    await run(
      [
        "aws",
        "s3",
        "cp",
        input.uri,
        input.readback,
        "--endpoint-url",
        SEAWEEDFS_ENDPOINT,
      ],
      options,
    );
  } catch {
    throw new Error(
      `Immutable archive publication is unconfirmed (upload exit ${String(publication.exitCode)})`,
    );
  }
  const digest = await staticArchiveDigest(input.readback);
  if (digest !== input.digest)
    throw new Error("Published archive failed immutable byte readback");
}
