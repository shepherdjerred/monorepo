import path from "node:path";
import { expect, test } from "vitest";
import { z } from "zod";

/**
 * Check 3: every workspace that depends on console-ui runs the per-app
 * conformance scan (`conformance.test.ts` beside its allowlist), or is
 * listed here with the reason it has no console client.
 */
const EXEMPT: Readonly<Record<string, string>> = {
  "@shepherdjerred/ops-model":
    "Reads tokens.json only, so its email palette test can match the console colours; it has no browser client.",
};

const packages = path.join(import.meta.dirname, "../..");

const ManifestSchema = z.object({
  name: z.string(),
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
});

async function consumers(): Promise<{ name: string; directory: string }[]> {
  const found: { name: string; directory: string }[] = [];
  const manifests = ["*/package.json", "*/packages/*/package.json"].flatMap(
    (pattern) => [...new Bun.Glob(pattern).scanSync({ cwd: packages })],
  );
  for (const file of manifests) {
    const manifest = ManifestSchema.parse(
      await Bun.file(path.join(packages, file)).json(),
    );
    const depends = { ...manifest.dependencies, ...manifest.devDependencies };
    if (
      manifest.name !== "@shepherdjerred/console-ui" &&
      "@shepherdjerred/console-ui" in depends
    ) {
      found.push({ name: manifest.name, directory: path.dirname(file) });
    }
  }
  return found.toSorted((a, b) => a.name.localeCompare(b.name));
}

/** The client directories a console keeps its scan in. */
const CLIENT_DIRECTORIES = ["client", "src/client"];

async function hasConformanceTest(directory: string): Promise<boolean> {
  for (const client of CLIENT_DIRECTORIES) {
    const base = path.join(packages, directory, client);
    const scan = Bun.file(path.join(base, "conformance.test.ts"));
    const allowlist = Bun.file(path.join(base, "conformance-allowlist.json"));
    if ((await scan.exists()) && (await allowlist.exists())) return true;
  }
  return false;
}

test("every console-ui consumer runs the conformance scan or is exempt", async () => {
  const found = await consumers();
  expect(found.length).toBeGreaterThanOrEqual(10);
  const missing: string[] = [];
  for (const { name, directory } of found) {
    if (name in EXEMPT) continue;
    if (!(await hasConformanceTest(directory))) missing.push(name);
  }
  expect(missing).toEqual([]);
});

test("every exemption is still a consumer", async () => {
  const found = await consumers();
  const names = new Set(found.map((consumer) => consumer.name));
  expect(Object.keys(EXEMPT).filter((name) => !names.has(name))).toEqual([]);
});
