import { z } from "zod";
import rawRegistry from "./image-registry.json" with { type: "json" };

export const ImageRegistrySchema = z
  .strictObject({
    $schema: z.string().min(1),
    schemaVersion: z.literal(1),
    registry: z.literal("docker.io"),
    namespace: z.literal("shepherdjerred"),
    images: z
      .array(
        z.strictObject({
          name: z.string().regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/u),
          visibility: z.enum(["public", "private"]),
        }),
      )
      .min(1),
  })
  .superRefine((registry, context) => {
    const names = new Set(registry.images.map((image) => image.name));
    if (names.size !== registry.images.length) {
      context.addIssue({
        code: "custom",
        path: ["images"],
        message: "image repository names must be unique",
      });
    }
  });

export type ImageRegistry = z.infer<typeof ImageRegistrySchema>;
export type ImageRegistration = ImageRegistry["images"][number];

export const imageRegistry = ImageRegistrySchema.parse(rawRegistry);

export function firstPartyImage(name: string): ImageRegistration {
  const image = imageRegistry.images.find((entry) => entry.name === name);
  if (image === undefined) {
    throw new Error(`Unregistered first-party image: ${name}`);
  }
  return image;
}

export function firstPartyImageRepository(name: string): string {
  const image = firstPartyImage(name);
  return `${imageRegistry.registry}/${imageRegistry.namespace}/${image.name}`;
}
