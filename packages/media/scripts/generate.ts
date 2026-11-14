import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

const root = path.resolve(import.meta.dir, "..");

async function generate(schema: string) {
  const child = Bun.spawn(
    ["bun", "--no-install", "prisma", "generate", "--schema", schema],
    {
      cwd: root,
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  if ((await child.exited) !== 0)
    throw new Error("Media Prisma generation failed");
}

await generate(path.join(root, "prisma/schema.prisma"));

// Historical migration fixtures execute real commands against pre038 schemas.
// Their client must not insert/read the later scalar, including implicit defaults.
const source = await Bun.file(path.join(root, "prisma/schema.prisma")).text();
const field = /^\s+libraryMonitoring\s+Boolean\s+@default\(false\)\s*$/mu;
if (!field.test(source))
  throw new Error("Historical intent schema boundary changed");
const generatorOutput = /output\s+=\s+"\.\.\/generated\/prisma"/u;
if (!generatorOutput.test(source))
  throw new Error("Media client output changed");
const householdFields = new Set([
  "libraryKeep",
  "libraryPolicyExplicit",
  "libraryPolicyActorId",
  "keepingPolicy",
  "interestState",
  "interestRevision",
  "interestRenewedAt",
  "usableUnwatchedSince",
  "lastMeaningfulProgressAt",
  "interestNoticeEventId",
  "interestNoticeRevision",
  "interestNoticeAcceptedAt",
  "interestNoticeViewedAt",
  "interestReleasedAt",
  "interestReleaseReason",
  "seriesStatus",
  "seriesStatusObservedAt",
  "catalogCompletedAt",
  "releaseDates",
]);
const historicalSource = source
  .replaceAll(
    /^model (?:MediaReleaseDate|PlaybackSession|PlaybackSessionIdentity|PlaybackCollector) \{[\s\S]+?^\}\n/gmu,
    "",
  )
  .split("\n")
  .filter((line) => !householdFields.has(line.trim().split(/\s+/u)[0] ?? ""))
  .join("\n");
const directory = await mkdtemp(
  path.join(tmpdir(), "media-historical-client-"),
);
try {
  const target = path.join(directory, "schema.prisma");
  const output = JSON.stringify(
    path.join(root, "generated/prisma-historical-intent"),
  );
  await Bun.write(
    target,
    historicalSource
      .replace(field, "")
      .replace(/^\s+availability\s+Json\?\s*$/mu, "")
      .replace(generatorOutput, `output = ${output}`),
  );
  await generate(target);
} finally {
  await rm(directory, { recursive: true, force: true });
}
