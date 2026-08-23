import { themes, viewports, type AuditTheme } from "#src/constants.ts";
import { auditRoutes, type AuditRoute } from "#src/routes.ts";

export const auditProjects = [
  { name: "chromium-desktop", browser: "chromium", viewport: "desktop" },
  { name: "chromium-laptop", browser: "chromium", viewport: "laptop" },
  { name: "chromium-tablet", browser: "chromium", viewport: "tablet" },
  { name: "chromium-mobile", browser: "chromium", viewport: "mobile" },
  { name: "webkit-desktop", browser: "webkit", viewport: "desktop" },
  { name: "webkit-mobile", browser: "webkit", viewport: "mobile" },
] as const;

export type AuditProject = (typeof auditProjects)[number];

export type AuditCase = {
  project: AuditProject;
  route: AuditRoute;
  theme: AuditTheme;
};

export function auditCaseTags(route: AuditRoute, theme: AuditTheme): string[] {
  const tags = [`@theme-${theme.name}`];
  if (route.golden) tags.push("@golden");
  return tags;
}

export function auditProjectGrep(project: AuditProject): RegExp {
  if (project.name === "chromium-desktop") return /.*/;
  if (project.name === "chromium-laptop") return /@golden/;
  if (
    project.name === "chromium-tablet" ||
    project.name === "chromium-mobile"
  ) {
    return /@golden|@theme-classic-light/;
  }
  return /@theme-modern-light/;
}

export function includesAuditCase(
  project: AuditProject,
  route: AuditRoute,
  theme: AuditTheme,
): boolean {
  if (project.name === "chromium-desktop") return true;
  if (project.name === "chromium-laptop") return route.golden;
  if (project.browser === "chromium") {
    return route.golden || theme.name === "classic-light";
  }
  return theme.name === "modern-light";
}

export function auditCases(): AuditCase[] {
  const cases: AuditCase[] = [];
  for (const project of auditProjects) {
    for (const route of auditRoutes()) {
      for (const theme of themes) {
        if (includesAuditCase(project, route, theme)) {
          cases.push({ project, route, theme });
        }
      }
    }
  }
  return cases;
}

export function auditViewport(project: AuditProject) {
  const viewport = viewports.find(
    (candidate) => candidate.name === project.viewport,
  );
  if (viewport === undefined) {
    throw new Error(`Unknown audit viewport ${project.viewport}`);
  }
  return viewport;
}
