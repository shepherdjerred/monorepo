import type { PlexItem } from "#integrations/plex.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import {
  associationHash,
  compare,
  decimalId,
  projectItem,
} from "./projection.ts";
import { plexRead } from "./io.ts";
import type { AssociationContext, VideoSection } from "./types.ts";
import type { ServingScope } from "./scope.ts";

export async function readSections(
  context: AssociationContext,
  scope: Pick<ServingScope, "access" | "serverMachineId">,
): Promise<VideoSection[]> {
  const machine = await plexRead(
    context,
    () => context.plex.machineIdentifier(context.execution.signal),
    "wrong_server",
  );
  if (machine !== scope.serverMachineId) {
    throw new PlexBindingProtection("wrong_server");
  }
  const available = await plexRead(
    context,
    () => context.plex.sections(context.execution.signal),
    "wrong_section",
  );
  if (new Set(available.map((row) => row.key)).size !== available.length) {
    throw new PlexBindingProtection("wrong_section");
  }
  const sections: VideoSection[] = available.flatMap((row) =>
    row.type === "movie" || row.type === "show"
      ? [{ sectionId: decimalId(row.key), sectionType: row.type }]
      : [],
  );
  if (
    sections.length === 0 ||
    sections.length > 100 ||
    scope.access.some(
      (access) =>
        !sections.some(
          (row) =>
            row.sectionId === access.sectionId &&
            row.sectionType === access.sectionType,
        ),
    )
  ) {
    throw new PlexBindingProtection("wrong_section");
  }
  return sections.sort((a, b) => compare(a.sectionId, b.sectionId));
}

export type InventoryItem = {
  section: VideoSection;
  item: PlexItem;
  projection: ReturnType<typeof projectItem>;
};

function appendPage(
  inventory: InventoryItem[],
  keys: Set<string>,
  section: VideoSection,
  items: readonly PlexItem[],
) {
  for (const item of items) {
    const projection = projectItem(item);
    if (keys.has(projection.ratingKey)) {
      throw new PlexBindingProtection("ambiguous_item");
    }
    if (
      projection.type !==
      (section.sectionType === "movie" ? "movie" : "episode")
    ) {
      throw new PlexBindingProtection("metadata_changed");
    }
    keys.add(projection.ratingKey);
    inventory.push({ section, item, projection });
  }
}

export async function scanInventory(
  context: AssociationContext,
  sections: readonly VideoSection[],
) {
  const inventory: InventoryItem[] = [];
  const keys = new Set<string>();
  for (const section of sections) {
    let offset = 0;
    let total: number | undefined;
    for (;;) {
      const page = await plexRead(
        context,
        () =>
          context.plex.libraryPage(
            {
              sectionId: section.sectionId,
              kind: section.sectionType === "movie" ? "movie" : "episode",
              offset,
              limit: 200,
            },
            context.execution.signal,
          ),
        "incomplete_inventory",
      );
      if (
        !Number.isSafeInteger(page.total) ||
        page.total > 10_000 ||
        (total !== undefined && total !== page.total) ||
        page.items.length > 200 ||
        offset + page.items.length > page.total ||
        (page.items.length === 0 && offset < page.total) ||
        inventory.length + page.items.length > 10_000
      ) {
        throw new PlexBindingProtection("incomplete_inventory");
      }
      total = page.total;
      appendPage(inventory, keys, section, page.items);
      offset += page.items.length;
      if (offset === total) {
        break;
      }
    }
  }
  inventory.sort(
    (a, b) =>
      compare(a.section.sectionId, b.section.sectionId) ||
      compare(a.projection.ratingKey, b.projection.ratingKey),
  );
  return {
    inventory,
    inventoryHash: associationHash(
      inventory.map((row) => ({ section: row.section, item: row.projection })),
    ),
  };
}
