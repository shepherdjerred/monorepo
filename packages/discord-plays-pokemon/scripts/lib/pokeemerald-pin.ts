import { parsePokemonUpstream } from "./upstream.ts";

const UPSTREAM_MANIFEST = new URL(
  "../../wasm-src/upstream.json",
  import.meta.url,
);

export async function readOttohgSha(): Promise<string> {
  const manifest: unknown = await Bun.file(UPSTREAM_MANIFEST).json();
  return parsePokemonUpstream(manifest).commit;
}
