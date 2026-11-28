import type { LinkItem } from "#shared/contract.ts";
import type { KindCounts, KindFilter } from "./directory-sections.tsx";

function isEditableElement(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(
      'input:not([type="radio"]):not([type="checkbox"]), textarea, select, [contenteditable="true"]',
    ) !== null
  );
}

/** `/` outside text fields and dialogs moves focus to the search field. */
export function isSearchShortcut(event: KeyboardEvent): boolean {
  return (
    event.key === "/" &&
    !event.isComposing &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !isEditableElement(event.target) &&
    !(
      event.target instanceof Element && event.target.closest("dialog") !== null
    )
  );
}

export function computeKindCounts(links: readonly LinkItem[]): KindCounts {
  let manual = 0;
  let ingress = 0;
  let site = 0;
  let alias = 0;
  for (const item of links) {
    switch (item.kind) {
      case "manual": {
        manual += 1;
        break;
      }
      case "ingress": {
        ingress += 1;
        break;
      }
      case "site": {
        site += 1;
        break;
      }
      case "alias": {
        alias += 1;
        break;
      }
      case "shortcut": {
        break;
      }
    }
  }
  return { all: links.length, manual, ingress, site, alias };
}

export function matchesSearchAndKind(
  item: LinkItem,
  normalizedQuery: string,
  kindFilter: KindFilter,
): boolean {
  if (kindFilter !== "all" && item.kind !== kindFilter) {
    return false;
  }
  if (normalizedQuery.length === 0) {
    return true;
  }
  const primaryMatch =
    item.short.toLowerCase().includes(normalizedQuery) ||
    `go/${item.short}`.toLowerCase().includes(normalizedQuery) ||
    item.targetUrl.toLowerCase().includes(normalizedQuery);
  if (primaryMatch) {
    return true;
  }
  const detailMatch =
    item.detail?.toLowerCase().includes(normalizedQuery) === true;
  const shadowMatch =
    item.shadows?.targetUrl.toLowerCase().includes(normalizedQuery) === true;
  return detailMatch || shadowMatch;
}
