import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { SCOUT_VOICE_CASCADE } from "../../data/src/scout-client/voice-cascade.schema.ts";
import {
  MODEL_DIRECTORY_NAME,
  MODEL_STAGING_DIRECTORY,
  requiredModelFiles,
} from "./voice-model-files.ts";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(path: string): string {
  return readFileSync(join(desktop, path), "utf8");
}

function resources(channel: string): unknown {
  const config: unknown = JSON.parse(read(`packaging/${channel}.json`));
  if (
    typeof config !== "object" ||
    config === null ||
    !("resources" in config)
  ) {
    throw new Error(`packaging/${channel}.json has no resources`);
  }
  return config.resources;
}

describe("voice model packaging", () => {
  test.each(["stable", "beta"])(
    "%s ships the staged model directory as voice-models",
    (channel) => {
      // cargo-packager resolves paths relative to the config file's directory.
      expect(resources(channel)).toEqual([
        { src: `../${MODEL_STAGING_DIRECTORY}`, target: MODEL_DIRECTORY_NAME },
      ]);
    },
  );

  test("the staged directory covers every file the contract names", () => {
    const { keywordSpotter: kws, vad, verifier } = SCOUT_VOICE_CASCADE.models;
    const everyName = new Set([
      kws.encoder.name,
      kws.decoder.name,
      kws.joiner.name,
      kws.tokens.name,
      kws.bpe.name,
      kws.keywords.name,
      vad.name,
      ...Object.values(verifier),
    ]);
    expect(new Set(requiredModelFiles())).toEqual(everyName);
    expect(requiredModelFiles()).toHaveLength(12);
  });

  test("the fetch script stages into the packaged directory and checks hashes", () => {
    const script = read("scripts/fetch-voice-models.ts");
    expect(script).toContain("MODEL_STAGING_DIRECTORY");
    expect(script).toContain("throw new Error(`${name} has SHA-256");
  });

  test("every packaging path assembles the models before the packager runs", () => {
    for (const channel of ["stable", "beta"]) {
      const config: unknown = JSON.parse(read(`packaging/${channel}.json`));
      expect(config).toMatchObject({
        beforePackagingCommand: `bun ../scripts/prepare-package.ts ${channel}`,
      });
    }
    const prepare = read("scripts/prepare-package.ts");
    expect(prepare.indexOf("fetch-voice-models.ts")).toBeGreaterThan(-1);
    expect(prepare.indexOf("fetch-voice-models.ts")).toBeLessThan(
      prepare.indexOf('cargo", "build'),
    );
  });
});
