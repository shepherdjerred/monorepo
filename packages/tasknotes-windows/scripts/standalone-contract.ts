import { Ajv2020 } from "ajv/dist/2020.js";
import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export type StandaloneDescriptor = {
  schemaVersion: 1;
  runId: string;
  packageFamilyName: string;
  profileId: string;
  stateDirectory: string;
  seedFiles: { path: string; sha256: string }[];
};

const schema = z
  .record(z.string(), z.unknown())
  .parse(
    await Bun.file(
      path.join(import.meta.dir, "../e2e/standalone/contract.json"),
    ).json(),
  );
const validator = new Ajv2020({ strict: true, allErrors: true });
validator.addSchema(schema, "acceptance");
const descriptorValidator = validator.compile<StandaloneDescriptor>({
  $ref: "acceptance#/$defs/descriptor",
});
export const StandaloneScenario = z.enum([
  "standalone-production",
  "accessibility-keyboard",
  "visual-modes",
]);
export type StandaloneScenarioId = z.infer<typeof StandaloneScenario>;
type RuntimeEvidence = {
  schemaVersion: 1;
  runId: string;
  scenario: StandaloneScenarioId;
  composition: "FacetTaskNotesStore";
  completed: true;
  assertions: string[];
};
type ScenarioManifest = {
  schemaVersion: 1;
  scenarios: Record<StandaloneScenarioId, string[]>;
};
const evidenceValidator = validator.compile<RuntimeEvidence>({
  $ref: "acceptance#/$defs/runtimeEvidence",
});
const manifestValidator = validator.compile<ScenarioManifest>({
  $ref: "acceptance#/$defs/scenarioManifest",
});

export async function standaloneScenarioManifest() {
  const document: unknown = await Bun.file(
    path.join(import.meta.dir, "../e2e/standalone/scenarios.json"),
  ).json();
  if (!manifestValidator(document))
    throw new Error("Invalid neutral standalone scenario manifest.");
  return document;
}

export async function validateStandaloneEvidence(
  document: unknown,
  runId: string,
  scenario: StandaloneScenarioId,
) {
  if (
    !evidenceValidator(document) ||
    document.runId !== runId ||
    document.scenario !== scenario
  )
    throw new Error(
      "Native runtime evidence does not belong to this exact standalone run and scenario.",
    );
  const manifest = await standaloneScenarioManifest();
  if (
    JSON.stringify([...document.assertions].sort()) !==
    JSON.stringify([...manifest.scenarios[scenario]].sort())
  )
    throw new Error(
      "Native runtime evidence does not exactly match its declared standalone assertion set.",
    );
  return document;
}

export function standaloneRunOptions(
  argumentsList: string[],
): StandaloneScenarioId {
  if (argumentsList.length === 0) return "standalone-production";
  if (argumentsList.length !== 2 || argumentsList[0] !== "--scenario")
    throw new Error(
      "Use --scenario standalone-production, accessibility-keyboard or visual-modes.",
    );
  return StandaloneScenario.parse(argumentsList[1]);
}

export function sha256(bytes: Uint8Array) {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

export function relativeSeedPath(value: string) {
  const parts = value.split("/");
  if (
    value.includes("\\") ||
    value.includes(":") ||
    /\p{Cc}/u.test(value) ||
    parts.some(
      (part) =>
        part === "" ||
        part === "." ||
        part === ".." ||
        /[ .]$/u.test(part) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part),
    )
  )
    throw new Error("Acceptance seed paths must be canonical relative paths.");
  return value;
}

export function parseStandaloneDescriptor(
  value: unknown,
  localState: string,
  packageFamilyName: string,
): StandaloneDescriptor {
  if (!descriptorValidator(value))
    throw new Error("Invalid standalone acceptance descriptor contract.");
  const expected = path.join(
    path.resolve(localState),
    "StandaloneAcceptance",
    value.runId,
  );
  if (
    value.packageFamilyName !== packageFamilyName ||
    value.profileId !== `acceptance-${value.runId}` ||
    value.stateDirectory !== expected ||
    new Set(value.seedFiles.map((file) => file.path.toUpperCase())).size !==
      value.seedFiles.length
  )
    throw new Error(
      "Standalone acceptance run or private profile identity changed.",
    );
  for (const file of value.seedFiles) relativeSeedPath(file.path);
  return value;
}

export async function requireUnlinkedPath(filename: string): Promise<void> {
  for (
    let current = path.resolve(filename);
    ;
    current = path.dirname(current)
  ) {
    const metadata = await lstat(current);
    if (metadata.isSymbolicLink())
      throw new Error("Acceptance paths cannot contain filesystem links.");
    if (path.dirname(current) === current) break;
  }
}

async function fixtureFiles(
  root: string,
  relative = "",
): Promise<{ path: string; bytes: Uint8Array }[]> {
  const result: { path: string; bytes: Uint8Array }[] = [];
  await requireUnlinkedPath(path.join(root, relative));
  for (const entry of await readdir(path.join(root, relative), {
    withFileTypes: true,
  })) {
    const name = relativeSeedPath(
      relative === "" ? entry.name : `${relative}/${entry.name}`,
    );
    const file = path.join(root, name);
    if (entry.isSymbolicLink())
      throw new Error("Acceptance fixtures cannot contain links.");
    if (entry.isDirectory()) result.push(...(await fixtureFiles(root, name)));
    else if (entry.isFile())
      result.push({ path: name, bytes: await readFile(file) });
    else throw new Error("Acceptance fixtures must be files or directories.");
  }
  return result;
}

/** Stage one fresh app-private run without resetting another run or starting an application. */
export async function prepareStandaloneRun(
  localState: string,
  packageFamilyName: string,
  fixture: string,
  options?: { runId?: string; additionalFixture?: string },
) {
  const runId = options?.runId ?? crypto.randomUUID();
  const additionalFixture = options?.additionalFixture;
  await requireUnlinkedPath(localState);
  const stateDirectory = path.join(localState, "StandaloneAcceptance", runId);
  const seeds = await fixtureFiles(fixture);
  if (additionalFixture !== undefined)
    seeds.push(...(await fixtureFiles(additionalFixture)));
  if (
    new Set(seeds.map((seed) => seed.path.toUpperCase())).size !== seeds.length
  )
    throw new Error("Acceptance seed roots cannot overlap file ownership.");
  if (!seeds.some((file) => file.path === "tasknotes.yaml"))
    throw new Error("The real TaskNotes configuration fixture is required.");
  const attachment = "Attachments/acceptance-preservation.bin";
  if (seeds.some((file) => file.path === attachment))
    throw new Error(
      "The acceptance binary preservation sentinel already exists.",
    );
  seeds.push({
    path: attachment,
    bytes: new Uint8Array([0, 127, 255, 1, 9, 0]),
  });
  seeds.sort((a, b) => (a.path < b.path ? -1 : a.path === b.path ? 0 : 1));
  const descriptor = parseStandaloneDescriptor(
    {
      schemaVersion: 1,
      runId,
      packageFamilyName,
      profileId: `acceptance-${runId}`,
      stateDirectory,
      seedFiles: seeds.map((file) => ({
        path: file.path,
        sha256: sha256(file.bytes),
      })),
    },
    localState,
    packageFamilyName,
  );
  const parent = path.dirname(stateDirectory);
  await mkdir(parent, { recursive: true });
  await requireUnlinkedPath(parent);
  await mkdir(stateDirectory);
  const vault = path.join(stateDirectory, "vault");
  await mkdir(vault);
  for (const seed of seeds) {
    const target = path.join(vault, seed.path);
    await mkdir(path.dirname(target), { recursive: true });
    await requireUnlinkedPath(path.dirname(target));
    await writeFile(target, seed.bytes, { flag: "wx", mode: 0o600 });
  }
  const descriptorPath = path.join(stateDirectory, "descriptor.json");
  await writeFile(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  await requireUnlinkedPath(descriptorPath);
  return { descriptor, descriptorPath, vault };
}
