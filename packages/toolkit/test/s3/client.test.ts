import { afterEach, describe, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { profileEndpointUrl } from "#lib/s3/client.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function configFile(contents: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aws-config-"));
  directories.push(directory);
  const file = path.join(directory, "config");
  await writeFile(file, contents);
  return file;
}

describe("profileEndpointUrl", () => {
  const config = [
    "[default]",
    "endpoint_url = https://default.example",
    "",
    "[profile brim-sync]",
    "region = us-east-1",
    "endpoint_url = https://seaweedfs.example",
    "",
    "[profile aws]",
    "region = us-east-1",
  ].join("\r\n");

  test("reads the named profile's endpoint, not the default's", async () => {
    const file = await configFile(config);
    expect(
      await profileEndpointUrl("brim-sync", { AWS_CONFIG_FILE: file }),
    ).toBe("https://seaweedfs.example");
    expect(await profileEndpointUrl("default", { AWS_CONFIG_FILE: file })).toBe(
      "https://default.example",
    );
  });

  test("leaves a profile without an endpoint to the SDK", async () => {
    const file = await configFile(config);
    expect(
      await profileEndpointUrl("aws", { AWS_CONFIG_FILE: file }),
    ).toBeUndefined();
    expect(
      await profileEndpointUrl("missing", { AWS_CONFIG_FILE: file }),
    ).toBeUndefined();
  });

  test("a missing config file means no endpoint", async () => {
    expect(
      await profileEndpointUrl("brim-sync", {}, "/nonexistent-home"),
    ).toBeUndefined();
  });
});
