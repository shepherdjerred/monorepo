import path from "node:path";
import { z } from "zod";

const packageRoot = path.resolve(import.meta.dir, "..");
const SourceSchema = z.enum(["macos", "ios"]);
const ApplicableFeatureSchema = z
  .object({
    id: z.string().min(1),
    sources: z.array(SourceSchema).min(1),
    disposition: z.literal("applicable"),
    windowsSurface: z.string().min(1),
    interaction: z.string().min(1),
    tests: z.array(z.string().min(1)).min(1),
    assertions: z.array(z.string().min(1)).min(1),
  })
  .strict();
const ExcludedFeatureSchema = z
  .object({
    id: z.string().min(1),
    sources: z.array(SourceSchema).min(1),
    disposition: z.literal("excluded"),
    reason: z.string().min(1),
    tests: z.array(z.string()).length(0),
    assertions: z.array(z.string()).length(0),
  })
  .strict();
const ParitySchema = z
  .object({
    schemaVersion: z.literal(1),
    features: z.array(
      z.discriminatedUnion("disposition", [
        ApplicableFeatureSchema,
        ExcludedFeatureSchema,
      ]),
    ),
  })
  .strict();
const ScenariosSchema = z
  .object({
    schemaVersion: z.literal(1),
    scenarios: z.array(
      z
        .object({
          id: z.string().min(1),
          test: z.string().min(1),
          assertions: z.array(z.string().min(1)).min(1),
        })
        .strict(),
    ),
  })
  .strict();

function addUnique(values: Set<string>, value: string, label: string): void {
  if (values.has(value)) {
    throw new Error(`duplicate ${label} '${value}'`);
  }
  values.add(value);
}

async function loadTestSource(): Promise<string> {
  const testRoot = path.join(packageRoot, "tests", "TaskNotes.Windows.E2E");
  const sources = await Array.fromAsync(
    new Bun.Glob("**/*.cs").scan({ cwd: testRoot, onlyFiles: true }),
  );
  const sourceTexts = await Promise.all(
    sources.map((source) => Bun.file(path.join(testRoot, source)).text()),
  );
  return sourceTexts.join("\n");
}

async function main(): Promise<void> {
  const parity = ParitySchema.parse(
    await Bun.file(path.join(packageRoot, "parity.json")).json(),
  );
  const scenariosDocument = ScenariosSchema.parse(
    await Bun.file(path.join(packageRoot, "e2e", "scenarios.json")).json(),
  );
  const scenarioIds = new Set<string>();
  const assertionOwners = new Map<string, string>();
  const testSource = await loadTestSource();
  for (const scenario of scenariosDocument.scenarios) {
    addUnique(scenarioIds, scenario.id, "E2E scenario id");
    for (const assertion of scenario.assertions) {
      const owner = assertionOwners.get(assertion);
      if (owner !== undefined) {
        throw new Error(
          `runtime assertion '${assertion}' belongs to both '${owner}' and '${scenario.id}'`,
        );
      }
      assertionOwners.set(assertion, scenario.id);
      const escapedAssertion = assertion.replaceAll(".", String.raw`\.`);
      const concreteRecord = new RegExp(
        String.raw`evidence\??\.Record\(\s*"${escapedAssertion}"\s*,\s*EvidenceKind\.[A-Za-z]+\s*,`,
        "u",
      );
      if (!concreteRecord.test(testSource)) {
        throw new Error(
          `runtime assertion '${assertion}' has no typed concrete evidence record`,
        );
      }
    }
    if (
      !testSource.includes(`TestCategory("${scenario.id}")`) ||
      !testSource.includes(` ${scenario.test}(`)
    ) {
      throw new Error(
        `E2E scenario '${scenario.id}' is not implemented by test method '${scenario.test}'`,
      );
    }
  }

  const featureIds = new Set<string>();
  const referencedScenarios = new Set<string>();
  const referencedAssertions = new Set<string>();
  for (const feature of parity.features) {
    addUnique(featureIds, feature.id, "parity feature id");
    for (const test of feature.tests) {
      if (!scenarioIds.has(test)) {
        throw new Error(
          `feature '${feature.id}' references unknown scenario '${test}'`,
        );
      }
      referencedScenarios.add(test);
    }
    for (const assertion of feature.assertions) {
      const owner = assertionOwners.get(assertion);
      if (owner === undefined) {
        throw new Error(
          `feature '${feature.id}' references unknown runtime assertion '${assertion}'`,
        );
      }
      if (!feature.tests.includes(owner)) {
        throw new Error(
          `feature '${feature.id}' assertion '${assertion}' is owned by unreferenced scenario '${owner}'`,
        );
      }
      referencedAssertions.add(assertion);
    }
  }

  for (const assertion of assertionOwners.keys()) {
    if (!referencedAssertions.has(assertion)) {
      throw new Error(
        `runtime assertion '${assertion}' is not required by the parity manifest`,
      );
    }
  }

  for (const scenario of scenarioIds) {
    if (!referencedScenarios.has(scenario)) {
      throw new Error(
        `E2E scenario '${scenario}' is not referenced by the parity manifest`,
      );
    }
  }

  if (/evidence\.Record\(\s*"[^"]+"\s*\)/u.test(testSource)) {
    throw new Error(
      "E2E assertions must record a proof kind and concrete observation",
    );
  }

  await Bun.write(
    Bun.stdout,
    `TaskNotes Windows parity: ${String(featureIds.size)} features, ${String(scenarioIds.size)} E2E scenarios, ${String(assertionOwners.size)} runtime assertions\n`,
  );
}

await main();
