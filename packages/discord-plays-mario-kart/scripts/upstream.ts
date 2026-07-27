import { z } from "zod";

const N64UpstreamSchema = z.object({
  repository: z.url(),
  branch: z.string().min(1),
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  emsdkImage: z.string().regex(/^emscripten\/emsdk:[^ ]+$/),
});

export type N64Upstream = z.infer<typeof N64UpstreamSchema>;

export function parseN64Upstream(value: unknown): N64Upstream {
  return N64UpstreamSchema.parse(value);
}

export function parseVendorExcludes(source: string): string[] {
  return source
    .split("\n")
    .map((line) => line.split("#", 1)[0]?.trim() ?? "")
    .filter((line) => line.length > 0);
}
