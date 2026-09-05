export type ProductionBakeIdentity = {
  readonly version: string;
  readonly gitSha: string;
  readonly contractHash: string;
};

export function productionBakeEnvironment(
  base: Readonly<Record<string, string | undefined>>,
  identity: ProductionBakeIdentity,
): Readonly<Record<string, string | undefined>> {
  return {
    ...base,
    VERSION: identity.version,
    GIT_SHA: identity.gitSha,
    CONTRACT_HASH: identity.contractHash,
    PUSH_CACHE: "true",
    PUSH_IMAGES: "true",
  };
}
