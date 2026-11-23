import { stdout } from "node:process";
import { parseArgs } from "node:util";
import { z } from "zod";
import { prepareReplayPublication } from "./replay-publication/package.ts";
import {
  createReplayPublicationClient,
  withReplayPublicationScratch,
} from "./replay-publication/publication-io.ts";
import {
  ScoutReplayStageSchema,
  scoutTarget,
} from "./replay-publication/scout-target.ts";
import { publishReplayObject } from "./replay-publication/storage.ts";

const flags = z.object({
  archive: z.string().min(1),
  "archive-sha256": z.string().regex(/^sha256:[a-f0-9]{64}$/),
  stage: ScoutReplayStageSchema,
  apply: z.boolean().default(false),
});

export function parseReplayPublicationArguments(args: readonly string[]) {
  const { values, tokens } = parseArgs({
    args: [...args],
    options: {
      archive: { type: "string" },
      "archive-sha256": { type: "string" },
      stage: { type: "string" },
      apply: { type: "boolean" },
    },
    tokens: true,
  });
  const seen = new Set<string>();
  for (const token of tokens) {
    if (token.kind !== "option") continue;
    if (seen.has(token.name))
      throw new Error(`--${token.name} may appear only once`);
    seen.add(token.name);
  }
  return flags.parse(values);
}

const dependencies = {
  prepare: prepareReplayPublication,
  createClient: createReplayPublicationClient,
  publish: publishReplayObject,
};

export async function runReplayPublication(
  options: z.infer<typeof flags>,
  deps: typeof dependencies = dependencies,
) {
  const { bucket, origin } = await scoutTarget(options.stage);
  return await withReplayPublicationScratch(async (directory) => {
    const archiveDigest = options["archive-sha256"];
    const prepared = await deps.prepare({
      archivePath: options.archive,
      archiveDigest,
      directory,
    });
    const manifestKey = `replay-assets/${prepared.gameBuild}/${prepared.manifestSha256}/manifest.json`;
    if (
      prepared.objects.at(-1)?.key !== manifestKey ||
      prepared.objects.slice(0, -1).some(({ key }) => key === manifestKey)
    )
      throw new Error("Prepared replay publication must end with its manifest");
    if (options.apply) {
      const client = deps.createClient();
      try {
        for (const object of prepared.objects) {
          await deps.publish({ client, bucket, origin, object });
        }
      } finally {
        client.destroy();
      }
    }
    return {
      outcome: options.apply ? "published" : "verified",
      stage: options.stage,
      bucket,
      origin: origin.origin,
      archiveDigest,
      gameBuild: prepared.gameBuild,
      protocol: prepared.protocol,
      manifestSha256: prepared.manifestSha256,
      manifestUrl: new URL(manifestKey, origin).href,
      objects: prepared.objects.map(({ key, bytes, sha256, contentType }) => ({
        key,
        bytes,
        sha256,
        contentType,
      })),
    };
  });
}

if (import.meta.main) {
  const options = parseReplayPublicationArguments(Bun.argv.slice(2));
  stdout.write(
    `${JSON.stringify(await runReplayPublication(options), null, 2)}\n`,
  );
}
