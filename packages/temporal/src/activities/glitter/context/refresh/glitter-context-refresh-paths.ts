const PACKAGE_PATH = "packages/glitter-context";

export const GLITTER_GENERATION_STATE_PATH = `${PACKAGE_PATH}/data/generation-state.json`;
export const GLITTER_PEOPLE_PATH = `${PACKAGE_PATH}/data/people.json`;
export const GLITTER_RELATIONSHIPS_PATH = `${PACKAGE_PATH}/data/relationships.json`;
export const GLITTER_GENERATED_DATA_PATH = `${PACKAGE_PATH}/src/generated-data.ts`;

export function isAllowedGlitterContextRefreshPath(path: string): boolean {
  return (
    path === GLITTER_GENERATION_STATE_PATH ||
    path === GLITTER_RELATIONSHIPS_PATH ||
    path === GLITTER_GENERATED_DATA_PATH ||
    /^packages\/glitter-context\/data\/style-cards\/[a-z0-9-]+_style\.json$/u.test(
      path,
    )
  );
}
