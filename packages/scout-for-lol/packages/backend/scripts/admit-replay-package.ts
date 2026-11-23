import { stdout } from "node:process";
import { parseArgs } from "node:util";
import { PlatformRouteSchema } from "@scout-for-lol/domain/identity/routes.ts";
import { z } from "zod";
import { verifyReplayAdmissionInputs } from "./replay-publication/admission-input.ts";
import { readReplayJsonInput } from "./replay-publication/local-json.ts";
import type { admitVerifiedReplayPackage } from "./replay-publication/registry.ts";
import {
  ScoutReplayStageSchema,
  scoutTarget,
} from "./replay-publication/scout-target.ts";

const flags = z.object({
  publication: z.string().min(1),
  admission: z.string().min(1),
  stage: ScoutReplayStageSchema,
  platform: PlatformRouteSchema,
  apply: z.boolean().default(false),
});

export function parseReplayAdmissionArguments(args: readonly string[]) {
  const { values, tokens } = parseArgs({
    args: [...args],
    options: {
      publication: { type: "string" },
      admission: { type: "string" },
      stage: { type: "string" },
      platform: { type: "string" },
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

const applyAdmission: typeof admitVerifiedReplayPackage = async (inputs) => {
  const databaseUrl = Bun.env["DATABASE_URL"];
  if (databaseUrl === undefined || databaseUrl === "")
    throw new Error(
      "--apply requires DATABASE_URL for the selected Scout stage",
    );
  const { prisma } = await import("#src/database/index.ts");
  try {
    const registry = await import("./replay-publication/registry.ts");
    return await registry.admitVerifiedReplayPackage(inputs);
  } finally {
    await prisma.$disconnect();
  }
};

const dependencies = {
  verify: verifyReplayAdmissionInputs,
  admit: applyAdmission,
};

export async function runReplayAdmission(
  options: z.infer<typeof flags>,
  deps: typeof dependencies = dependencies,
) {
  const { bucket, origin } = await scoutTarget(options.stage);
  const { value: publication } = await readReplayJsonInput(
    options.publication,
    "publication",
  );
  const { value: admission } = await readReplayJsonInput(
    options.admission,
    "admission",
  );
  const verified = await deps.verify({
    bucket,
    origin,
    stage: options.stage,
    publication,
    admission,
  });
  const outcome = options.apply
    ? await deps.admit({
        stage: options.stage,
        platformId: options.platform,
        verified,
      })
    : "verified";
  return {
    outcome,
    stage: options.stage,
    platformId: options.platform,
    bucket,
    origin: origin.origin,
    gameBuild: verified.gameBuild,
    protocol: verified.protocol,
    manifestSha256: verified.manifestSha256,
    manifestUrl: new URL(verified.manifestPath, origin).href,
  };
}

if (import.meta.main) {
  const options = parseReplayAdmissionArguments(Bun.argv.slice(2));
  stdout.write(`${JSON.stringify(await runReplayAdmission(options))}\n`);
}
