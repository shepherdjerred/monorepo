export function installPaths(home: string): {
  readonly binary: string;
  readonly legacyBinary: string;
  readonly brimBinary: string;
} {
  return {
    binary: `${home}/.local/bin/toolkit`,
    legacyBinary: `${home}/.local/bin/tools`,
    brimBinary: `${home}/.local/bin/brim`,
  };
}
