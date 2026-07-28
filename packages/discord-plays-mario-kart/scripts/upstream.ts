import { z } from "zod";

const N64UpstreamSchema = z.object({
  repository: z.url(),
  branch: z.string().min(1),
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  emsdkImage: z
    .string()
    .regex(/^emscripten\/emsdk:[^ @]+@sha256:[a-f0-9]{64}$/),
});

export type N64Upstream = z.infer<typeof N64UpstreamSchema>;

export function parseN64Upstream(value: unknown): N64Upstream {
  return N64UpstreamSchema.parse(value);
}

export function extractEmsdkImageFromDockerfile(source: string): string {
  const match =
    /^FROM (emscripten\/emsdk:[^ @]+@sha256:[a-f0-9]{64}) AS wasm-builder$/m.exec(
      source,
    );
  const image = match?.[1];
  if (image === undefined) {
    throw new Error("Dockerfile is missing the immutable Emscripten build pin");
  }
  return image;
}

export function parseVendorExcludes(source: string): string[] {
  return source
    .split("\n")
    .map((line) => line.split("#", 1)[0]?.trim() ?? "")
    .filter((line) => line.length > 0);
}

export function upstreamFetchCommand(
  clone: string,
  commit: string,
): readonly string[] {
  return [
    "git",
    "-C",
    clone,
    "-c",
    "http.postBuffer=524288000",
    "fetch",
    "--quiet",
    "--depth",
    "1",
    "origin",
    commit,
  ];
}
