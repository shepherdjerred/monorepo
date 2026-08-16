export const themes = [
  { name: "modern-light", skin: "modern", mode: "light" },
  { name: "modern-dark", skin: "modern", mode: "dark" },
  { name: "classic-light", skin: "classic", mode: "light" },
  { name: "classic-dark", skin: "classic", mode: "dark" },
] as const;

export type AuditTheme = (typeof themes)[number];

export const viewports = [
  { name: "desktop", width: 1440, height: 900, isMobile: false },
  { name: "laptop", width: 1280, height: 800, isMobile: false },
  { name: "tablet", width: 768, height: 1024, isMobile: true },
  { name: "mobile", width: 390, height: 844, isMobile: true },
] as const;

export type AuditViewport = (typeof viewports)[number];
