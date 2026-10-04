/**
 * Block states in Minecraft's string form: `minecraft:oak_stairs[facing=east,half=bottom]`.
 * Properties are kept sorted by name so equal states always format identically.
 */
export type BlockState = {
  readonly id: string;
  readonly properties: Readonly<Record<string, string>>;
};

const STATE_PATTERN = /^([a-z0-9_.-]+:)?([a-z0-9_./-]+)(?:\[([^\]]*)\])?$/u;

export function parseBlockState(raw: string): BlockState {
  const match = STATE_PATTERN.exec(raw.trim());
  if (match === null) {
    throw new Error(`Invalid block state "${raw}"`);
  }
  const namespace = match[1] ?? "minecraft:";
  const name = match[2] ?? "";
  const props: Record<string, string> = {};
  const body = match[3];
  if (body !== undefined && body.length > 0) {
    for (const pair of body.split(",")) {
      const [key, value, ...rest] = pair.split("=");
      if (
        key === undefined ||
        value === undefined ||
        rest.length > 0 ||
        key.length === 0 ||
        value.length === 0
      ) {
        throw new Error(`Invalid property "${pair}" in block state "${raw}"`);
      }
      if (key.trim() in props) {
        throw new Error(`Duplicate property "${key}" in block state "${raw}"`);
      }
      props[key.trim()] = value.trim();
    }
  }
  return { id: `${namespace}${name}`, properties: props };
}

export function formatBlockState(state: BlockState): string {
  const keys = Object.keys(state.properties).toSorted();
  if (keys.length === 0) {
    return state.id;
  }
  const body = keys
    .map((key) => `${key}=${state.properties[key] ?? ""}`)
    .join(",");
  return `${state.id}[${body}]`;
}

/** Canonical string form: namespaced id and sorted properties. */
export function normalizeBlockState(raw: string): string {
  return formatBlockState(parseBlockState(raw));
}

export function blockId(raw: string): string {
  return parseBlockState(raw).id;
}

export function withProperties(
  raw: string,
  properties: Record<string, string>,
): string {
  const state = parseBlockState(raw);
  return formatBlockState({
    id: state.id,
    properties: { ...state.properties, ...properties },
  });
}

const AIR_IDS = new Set([
  "minecraft:air",
  "minecraft:cave_air",
  "minecraft:void_air",
]);

export function isAir(raw: string): boolean {
  return AIR_IDS.has(blockId(raw));
}
