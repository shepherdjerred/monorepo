import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { atomicJSON, digest, runDirectory, type Manifest } from "./model";
import { save } from "./platform";
import { waitForConvergence } from "./native";
import { readOfficialArtifact } from "./official-artifact";

export const officialSteps = z.enum([
  "create",
  "edit",
  "complete",
  "uncomplete",
]);
type Step = z.infer<typeof officialSteps>;

export function officialInstructions(manifest: Manifest) {
  const title = `Official UI ${manifest.runID}-${String(manifest.round)}`;
  console.log(
    `In official Obsidian's TaskNotes 4.13.8 UI, create exactly one task titled '${title}' in Tasks/. Run official-ui ${manifest.runID} create. Then edit its title to '${title} edited' and run official-ui ... edit; complete it and run official-ui ... complete; uncomplete it and run official-ui ... uncomplete. Execute each check after its UI action. Keep credential entry and unrelated account screens outside recordings.`,
  );
  console.log(
    `After each action, save a real synthetic-vault-only screenshot to ${path.join(runDirectory(manifest.runID), "official-ui", `round-${String(manifest.round)}`, "<step>.png")}. A reviewer must inspect these images; the runner checks image integrity and file convergence only.`,
  );
}

export function assertOfficialTask(
  bytes: Uint8Array,
  title: string,
  completed: boolean,
) {
  const source = new TextDecoder().decode(bytes);
  const yaml = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(source)?.[1];
  if (yaml === undefined)
    throw new Error("Official task is missing frontmatter");
  const task = z
    .object({
      title: z.literal(title),
      status: z.enum(["open", "done"]),
      completedDate: z.unknown().optional(),
    })
    .parse(Bun.YAML.parse(yaml));
  if (task.status !== (completed ? "done" : "open"))
    throw new Error("Official task has the wrong completion state");
  const hasDate =
    task.completedDate !== undefined && task.completedDate !== null;
  if (hasDate !== completed)
    throw new Error("Official task completion date does not match its state");
}

export async function officialUI(manifest: Manifest, step: Step) {
  const sequence = officialSteps.options;
  const index = sequence.indexOf(step);
  const previous = sequence[index - 1];
  if (
    previous !== undefined &&
    manifest.operations[`official-ui:${previous}`] !== "pass"
  )
    throw new Error("Verify each official UI action in order");
  if (manifest.cases["initial-download"] !== "pass")
    throw new Error("Verify the initial download first");
  const directory = runDirectory(manifest.runID);
  const artifact = await readOfficialArtifact(
    path.join(directory, "official-ui", `round-${String(manifest.round)}`),
    step,
  );
  const vault = path.join(directory, "reference-vault");
  const checkpointFile = path.join(
    directory,
    `official-ui-round-${String(manifest.round)}.json`,
  );
  const title = `Official UI ${manifest.runID}-${String(manifest.round)}${step === "create" ? "" : " edited"}`;
  let relative: string;
  if (step === "create") {
    const additions = [
      ...new Bun.Glob("**/*").scanSync({
        cwd: vault,
        dot: true,
        onlyFiles: true,
      }),
    ].filter(
      (filename) =>
        !filename.startsWith(".obsidian/") && !(filename in manifest.reference),
    );
    [relative] = z
      .tuple([z.string().regex(/^Tasks\/.+\.md$/u)])
      .parse(additions);
  } else {
    const checkpoint = z
      .object({
        runID: z.literal(manifest.runID),
        round: z.literal(manifest.round),
        relative: z.string().regex(/^Tasks\/.+\.md$/u),
      })
      .parse(await Bun.file(checkpointFile).json());
    relative = checkpoint.relative;
  }
  const bytes = await readFile(path.join(vault, relative));
  assertOfficialTask(bytes, title, step === "complete");
  const expected = {
    ...manifest.reference,
    [relative]: { size: bytes.length, sha256: digest(bytes) },
  };
  const clients = await waitForConvergence(manifest, expected);
  manifest.reference = expected;
  await atomicJSON(checkpointFile, {
    schemaVersion: 1,
    runID: manifest.runID,
    round: manifest.round,
    relative,
  });
  await atomicJSON(path.join(directory, `official-ui-${step}.json`), {
    schemaVersion: 1,
    runID: manifest.runID,
    round: manifest.round,
    ownerAttestedAction: `TaskNotes UI ${step}`,
    artifact: {
      ...artifact,
      filename: path.relative(directory, artifact.filename),
    },
    visualVerification: "requires reviewer inspection",
    observedExactState: true,
    clients,
  });
  if (step === "uncomplete") manifest.cases["official-ui"] = "pass";
  await save(manifest);
  console.log(
    `Owner-attested TaskNotes ${step}: exact state and three replicas verified; screenshot retained for visual inspection.`,
  );
}
