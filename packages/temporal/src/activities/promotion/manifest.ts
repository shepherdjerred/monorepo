import manifest from "@shepherdjerred/the-storm/promotion/targets.json" with { type: "json" };
import {
  PromotionManifestSchema,
  type PromotionTarget,
} from "#shared/promotion.ts";
import { z } from "zod/v4";

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
  let title = target.title;
  if (title === undefined && target.content !== "directory") {
    const titleSource = await Bun.file(
      new URL("copy/reddit-titles.txt", root),
    ).text();
    const titles: Record<string, string> = Object.fromEntries(
      titleSource
        .trim()
        .split(/\n\s*\n/)
        .map((block) => {
          const [community, ...lines] = block.split("\n");
          return [
            z.string().min(1).parse(community),
            z.string().min(1).parse(lines.join("\n")),
          ] as const;
        }),
    );
    title = z
      .string()
      .min(1)
      .parse(
        titles[
          target.content === "reddit-mcservers"
            ? "r/mcservers"
            : "r/MinecraftServer"
        ],
      );
  }
  return [
    ...(title === undefined
      ? []
      : [
          `Assigned title: ${title}\nUse this supplied title for the assigned destination; no additional community-specific title approval is required.`,
        ]),
    ...content,
  ].join("\n\n");
}

/** Inventory reference for locating placements; scheduling belongs to the caller. */
export async function promotionMaintenanceContext(): Promise<string> {
  const inventory = new URL(
    "manifest.md",
    import.meta.resolve("@shepherdjerred/the-storm/promotion/targets.json"),
  );
  const text = await Bun.file(inventory).text();
  const end = text.indexOf("## Accounts");
  if (end === -1)
    throw new Error("Promotion inventory is missing its account boundary");
  return text.slice(0, end);
}
