import { TestManifestSchema } from "../ci/test-manifest-schema.ts";

/** Resolve reviewed local script names without exempting any required check. */
export async function loadLocalVerification(
  root: string,
  packages: ReadonlyMap<string, { name?: string | undefined }>,
) {
  const manifest = TestManifestSchema.parse(
    await Bun.file(`${root}/scripts/ci-test-manifest.json`).json(),
  );
  const entries = manifest.separateTests.filter(
    (entry) => entry.localScripts !== undefined,
  );
  const errors: string[] = [];
  for (const entry of entries) {
    const packageJson = packages.get(entry.directory);
    if (packageJson === undefined) {
      errors.push(
        `local verification workspace is not declared: ${entry.directory}`,
      );
    } else if (packageJson.name !== entry.package) {
      errors.push(
        `local verification package name does not match ${entry.directory}`,
      );
    }
  }
  return {
    scriptNames: new Map(
      entries.map((entry) => [entry.directory, entry.localScripts]),
    ),
    errors,
  };
}
