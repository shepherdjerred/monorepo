export const themes = [
  { name: "modern-light", skin: "modern", mode: "light" },
  { name: "modern-dark", skin: "modern", mode: "dark" },
  { name: "classic-light", skin: "classic", mode: "light" },
  { name: "classic-dark", skin: "classic", mode: "dark" },
] as const;

export type AuditTheme = (typeof themes)[number];

/**
 * The made-up champion snapshot the public site is built from during the
 * audit, relative to the frontend package. The committed snapshot holds only
 * what the meta API served, so the champion routes would otherwise have no
 * pages to render.
 */
export const CHAMPION_META_FIXTURE_INDEX =
  "src/lib/champion-meta/__fixtures__/snapshot-v2/champion-meta/index.json";

export const viewports = [
  { name: "desktop", width: 1440, height: 900, isMobile: false },
  { name: "laptop", width: 1280, height: 800, isMobile: false },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "mobile", width: 390, height: 844, isMobile: true },
] as const;
