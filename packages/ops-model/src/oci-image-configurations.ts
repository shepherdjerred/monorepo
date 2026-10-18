import { z } from "zod";

const Image = z.object({
  os: z.literal("linux"),
  architecture: z.string().min(1),
  config: z.object({
    Env: z.array(z.string()),
    Labels: z.record(z.string(), z.string()).optional(),
  }),
});

/** buildx .Image is one OCI configuration or a platform-keyed map, never a single-platform guess. */
export function ociImageConfigurations(raw: unknown) {
  const single = Image.safeParse(raw);
  const images = single.success
    ? [single.data]
    : Object.values(z.record(z.string(), Image).parse(raw));
  if (!images.some((image) => image.architecture === "amd64"))
    throw new Error("Image lacks the production linux/amd64 platform");
  return images;
}
