import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { defineConfig } from "@shepherdjerred/config/index.ts";
import { createFileSource } from "@shepherdjerred/config/sources/file.ts";
import { createEnvSource } from "@shepherdjerred/config/sources/env.ts";

const directories: string[] = [];

async function writeFixture(name: string, contents: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "config-file-source-"));
  directories.push(directory);
  const filePath = path.join(directory, name);
  await Bun.write(filePath, contents);
  return filePath;
}

afterEach(async () => {
  // Written under the OS temp dir, never the repo: a test that deletes paths
  // must not be able to reach the working tree.
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true })),
  );
});

const DEFINITION = {
  streamBitrateKbps: {
    schema: z.coerce.number().int().positive(),
    sources: ["env", "file", "default"],
    default: 4000,
  },
} as const;

describe("file source", () => {
  test("reads a dotted path out of TOML", async () => {
    const fixture = await writeFixture(
      "config.toml",
      "[stream]\nbitrate.kbps = 9000\n",
    );
    const resolver = defineConfig({
      definition: DEFINITION,
      sources: { file: await createFileSource({ path: fixture }) },
    });
    await expect(resolver.get("streamBitrateKbps")).resolves.toEqual({
      value: 9000,
      source: "file",
    });
  });

  test("reads a dotted path out of JSON", async () => {
    const fixture = await writeFixture(
      "config.json",
      JSON.stringify({ stream: { bitrate: { kbps: 7000 } } }),
    );
    const resolver = defineConfig({
      definition: DEFINITION,
      sources: { file: await createFileSource({ path: fixture }) },
    });
    await expect(resolver.value("streamBitrateKbps")).resolves.toBe(7000);
  });

  test("env still outranks the file", async () => {
    const fixture = await writeFixture(
      "config.toml",
      "[stream]\nbitrate.kbps = 9000\n",
    );
    const resolver = defineConfig({
      definition: DEFINITION,
      sources: {
        env: createEnvSource({ STREAM_BITRATE_KBPS: "1234" }),
        file: await createFileSource({ path: fixture }),
      },
    });
    await expect(resolver.get("streamBitrateKbps")).resolves.toEqual({
      value: 1234,
      source: "env",
    });
  });

  test("a missing file is absent, not an error", async () => {
    // The normal case for our own Kubernetes deployments: this layer exists
    // for apps distributed to people who have neither Flipt nor env injection.
    const resolver = defineConfig({
      definition: DEFINITION,
      sources: {
        file: await createFileSource({ path: "/nonexistent/config.toml" }),
      },
    });
    await expect(resolver.get("streamBitrateKbps")).resolves.toEqual({
      value: 4000,
      source: "default",
    });
  });

  test("an unparseable file throws rather than reading as absent", async () => {
    // Silently ignoring it would make a typo'd TOML indistinguishable from no
    // file at all, which is precisely when an operator needs to be told.
    const fixture = await writeFixture("config.toml", "this is = = not toml\n");
    await expect(createFileSource({ path: fixture })).rejects.toThrow(
      /failed to parse/,
    );
  });

  test("a missing path inside a present file is absent", async () => {
    const fixture = await writeFixture(
      "config.toml",
      "[unrelated]\nvalue = 1\n",
    );
    const resolver = defineConfig({
      definition: DEFINITION,
      sources: { file: await createFileSource({ path: fixture }) },
    });
    await expect(resolver.get("streamBitrateKbps")).resolves.toEqual({
      value: 4000,
      source: "default",
    });
  });
});
