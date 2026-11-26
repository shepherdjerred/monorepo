import {
  RESERVED_SLUGS,
  normalizeShortSlug,
  type LinkItem,
} from "#shared/contract.ts";
import type { KindCounts, KindFilter } from "./directory-sections.tsx";

export function extractInitialMissingSlug(): string | null {
  const params = new URLSearchParams(globalThis.location.search);
  const queryMissing = params.get("missing");
  if (queryMissing !== null) {
    const normalized = normalizeShortSlug(queryMissing);
    if (normalized.length > 0 && !RESERVED_SLUGS.has(normalized)) {
      return normalized;
    }
  }

  const pathname = globalThis.location.pathname;
  if (pathname === "/" || pathname === "/index.html") {
    return null;
  }
  let rawSegment = pathname.replaceAll(/^\/+|\/+$/gu, "");
  try {
    rawSegment = decodeURIComponent(rawSegment);
  } catch {
    // Keep raw path when percent-decoding fails.
  }
  const candidate = normalizeShortSlug(rawSegment);
  return candidate.length === 0 || RESERVED_SLUGS.has(candidate)
    ? null
    : candidate;
}

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

export function clearUrlPathToRoot(): void {
  if (
    globalThis.location.pathname !== "/" ||
    globalThis.location.search.length > 0
  ) {
    globalThis.history.replaceState(null, "", "/");
  }
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
