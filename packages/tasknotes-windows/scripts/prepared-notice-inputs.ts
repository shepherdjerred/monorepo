export async function preparedNoticeInputs(
  repositoryRoot: string,
): Promise<string[]> {
  const inputs = new Set([
    "LICENSE",
    "global.json",
    "packages/tasknotes-core/Cargo.lock",
    "packages/tasknotes-core/Cargo.toml",
    "packages/tasknotes-windows/Directory.Packages.props",
    "packages/tasknotes-windows/Directory.Build.props",
    "packages/tasknotes-windows/Directory.Build.targets",
    "packages/tasknotes-windows/scripts/cross-build.sh",
    "packages/tasknotes-windows/scripts/prepare-notices.ts",
    "packages/tasknotes-windows/scripts/prepared-notice-inputs.ts",
    "packages/tasknotes-windows/scripts/generate-nuget-notices.ts",
    "packages/tasknotes-windows/scripts/nuget-license-provenance.ts",
    "packages/tasknotes-macos/scripts/generate-native-notices.ts",
  ]);
  for (const pattern of [
    "packages/tasknotes-core/{crates,xtask}/**/Cargo.toml",
    "packages/tasknotes-windows/src/**/{packages.lock.json,*.csproj}",
    "packages/tasknotes-windows/scripts/license-texts/*",
    "packages/tasknotes-macos/scripts/license-texts/*",
  ]) {
    for await (const file of new Bun.Glob(pattern).scan({
      cwd: repositoryRoot,
      onlyFiles: true,
    }))
      inputs.add(file);
  }
  return [...inputs].sort();
}
