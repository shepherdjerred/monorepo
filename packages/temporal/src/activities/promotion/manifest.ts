import manifest from "@shepherdjerred/the-storm/promotion/targets.json" with { type: "json" };
import {
  PromotionManifestSchema,
  type PromotionTarget,
} from "#shared/promotion.ts";

export const promotionManifest = PromotionManifestSchema.parse(manifest);

export function promotionTarget(id: string): PromotionTarget {
  const target = promotionManifest.targets.find((item) => item.id === id);
  if (target === undefined) throw new Error(`Unknown promotion target: ${id}`);
  return target;
}

export async function promotionContent(
  target: PromotionTarget,
): Promise<string> {
  const root = new URL(
    ".",
    import.meta.resolve("@shepherdjerred/the-storm/promotion/targets.json"),
  );
  const files =
    target.content === "directory"
      ? ["directory-description.txt", "short-descriptions.txt"]
      : [`${target.content}.md`, "reddit-titles.txt"];
  const content = await Promise.all(
    files.map(
      async (file) =>
        `${file}:\n${await Bun.file(new URL(`copy/${file}`, root)).text()}`,
    ),
  );
  return content.join("\n\n");
}
