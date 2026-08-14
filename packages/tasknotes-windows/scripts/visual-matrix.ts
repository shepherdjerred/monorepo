import path from "node:path";
import { z } from "zod";

const packageRoot = path.resolve(import.meta.dir, "..");
const profiles = [
  "100-light",
  "200-light",
  "100-dark",
  "200-dark",
  "100-high-contrast",
  "200-high-contrast",
] as const;
const ProfileSchema = z.enum(profiles);
const EvidenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    profile: ProfileSchema,
    revision: z.string().regex(/^[0-9a-f]{40}$/u),
    recordedAtUtc: z.iso.datetime(),
    e2eScenario: z.literal("visual-modes"),
  })
  .strict();

const revisionProcess = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
  cwd: packageRoot,
  stdout: "pipe",
  stderr: "inherit",
});
if (revisionProcess.exitCode !== 0) {
  throw new Error(
    "Unable to resolve the current commit for the visual matrix.",
  );
}
const revision = new TextDecoder().decode(revisionProcess.stdout).trim();
const maximumAgeMilliseconds = 24 * 60 * 60 * 1000;
const failures: string[] = [];
for (const profile of profiles) {
  const evidencePath = path.join(
    packageRoot,
    "artifacts",
    "visual-matrix",
    `${profile}.json`,
  );
  if (!(await Bun.file(evidencePath).exists())) {
    failures.push(`${profile}: evidence is missing`);
    continue;
  }
  const evidence = EvidenceSchema.parse(await Bun.file(evidencePath).json());
  if (evidence.profile !== profile) {
    failures.push(`${profile}: file declares ${evidence.profile}`);
  }
  if (evidence.revision !== revision) {
    failures.push(
      `${profile}: evidence is for ${evidence.revision}, not ${revision}`,
    );
  }
  const age = Date.now() - Date.parse(evidence.recordedAtUtc);
  if (age < 0 || age > maximumAgeMilliseconds) {
    failures.push(
      `${profile}: evidence is not fresh (maximum age is 24 hours)`,
    );
  }
}
if (failures.length > 0) {
  throw new Error(
    `Windows visual matrix is incomplete:\n\n${failures.map((failure) => `- ${failure}`).join("\n")}\n\nRun each profile in a real unlocked Windows session with TASKNOTES_VISUAL_PROFILE set and bun run windows:visual-profile.`,
  );
}
await Bun.write(
  Bun.stdout,
  `Windows visual matrix passed all six real profiles for ${revision}.\n`,
);
