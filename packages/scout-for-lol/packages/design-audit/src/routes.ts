export type AuditSurface = "public" | "docs" | "app";

export type AuditRoute = {
  name: string;
  surface: AuditSurface;
  path: string;
  authenticated: boolean;
  golden: boolean;
};

const publicRoutes: AuditRoute[] = [
  {
    name: "home",
    surface: "public",
    path: "/",
    authenticated: false,
    golden: true,
  },
  {
    name: "getting-started",
    surface: "public",
    path: "/getting-started/",
    authenticated: false,
    golden: true,
  },
  {
    name: "support",
    surface: "public",
    path: "/support/",
    authenticated: false,
    golden: true,
  },
  {
    name: "whats-new",
    surface: "public",
    path: "/whatsnew/",
    authenticated: false,
    golden: true,
  },
  {
    name: "privacy",
    surface: "public",
    path: "/privacy/",
    authenticated: false,
    golden: false,
  },
  {
    name: "terms",
    surface: "public",
    path: "/tos/",
    authenticated: false,
    golden: false,
  },
];

const docsRoutes: AuditRoute[] = [
  {
    name: "docs-home",
    surface: "docs",
    path: "/docs/",
    authenticated: false,
    golden: true,
  },
  {
    name: "first-report",
    surface: "docs",
    path: "/docs/tutorials/first-report/",
    authenticated: false,
    golden: true,
  },
  {
    name: "first-competition",
    surface: "docs",
    path: "/docs/tutorials/first-competition/",
    authenticated: false,
    golden: false,
  },
  {
    name: "first-notification",
    surface: "docs",
    path: "/docs/tutorials/first-notification/",
    authenticated: false,
    golden: false,
  },
  {
    name: "dashboard-reference",
    surface: "docs",
    path: "/docs/reference/dashboard/",
    authenticated: false,
    golden: true,
  },
  {
    name: "permissions-reference",
    surface: "docs",
    path: "/docs/reference/permissions/",
    authenticated: false,
    golden: false,
  },
  {
    name: "how-scout-works",
    surface: "docs",
    path: "/docs/explanation/how-scout-works/",
    authenticated: false,
    golden: false,
  },
  {
    name: "access-model",
    surface: "docs",
    path: "/docs/explanation/access-model/",
    authenticated: false,
    golden: false,
  },
  {
    name: "discord-commands",
    surface: "docs",
    path: "/docs/reference/discord-commands/",
    authenticated: false,
    golden: false,
  },
  {
    name: "competitions-reference",
    surface: "docs",
    path: "/docs/reference/competitions/",
    authenticated: false,
    golden: false,
  },
  {
    name: "scoutql-filters",
    surface: "docs",
    path: "/docs/reference/scoutql-filters/",
    authenticated: false,
    golden: false,
  },
  {
    name: "queues-and-regions",
    surface: "docs",
    path: "/docs/reference/queues-and-regions/",
    authenticated: false,
    golden: false,
  },
  {
    name: "scoutql-sources",
    surface: "docs",
    path: "/docs/reference/scoutql-sources/",
    authenticated: false,
    golden: false,
  },
  {
    name: "schedules-and-limits",
    surface: "docs",
    path: "/docs/reference/schedules-and-limits/",
    authenticated: false,
    golden: false,
  },
  {
    name: "scoutql",
    surface: "docs",
    path: "/docs/reference/scoutql/",
    authenticated: false,
    golden: false,
  },
  {
    name: "scoutql-metrics",
    surface: "docs",
    path: "/docs/reference/scoutql-metrics/",
    authenticated: false,
    golden: false,
  },
  {
    name: "scoutql-render",
    surface: "docs",
    path: "/docs/reference/scoutql-render/",
    authenticated: false,
    golden: false,
  },
  {
    name: "players-accounts-subscriptions",
    surface: "docs",
    path: "/docs/explanation/players-accounts-subscriptions/",
    authenticated: false,
    golden: false,
  },
  {
    name: "web-first",
    surface: "docs",
    path: "/docs/explanation/web-first/",
    authenticated: false,
    golden: false,
  },
  {
    name: "run-competitions",
    surface: "docs",
    path: "/docs/how-to/run-competitions/",
    authenticated: false,
    golden: false,
  },
  {
    name: "add-players",
    surface: "docs",
    path: "/docs/how-to/add-players/",
    authenticated: false,
    golden: false,
  },
  {
    name: "grant-access",
    surface: "docs",
    path: "/docs/how-to/grant-access/",
    authenticated: false,
    golden: false,
  },
  {
    name: "fix-duplicate-players",
    surface: "docs",
    path: "/docs/how-to/fix-duplicate-players/",
    authenticated: false,
    golden: false,
  },
  {
    name: "schedule-reports",
    surface: "docs",
    path: "/docs/how-to/schedule-reports/",
    authenticated: false,
    golden: false,
  },
  {
    name: "troubleshoot-notifications",
    surface: "docs",
    path: "/docs/how-to/troubleshoot-notifications/",
    authenticated: false,
    golden: false,
  },
  {
    name: "route-notifications",
    surface: "docs",
    path: "/docs/how-to/route-notifications/",
    authenticated: false,
    golden: false,
  },
  {
    name: "link-discord-users",
    surface: "docs",
    path: "/docs/how-to/link-discord-users/",
    authenticated: false,
    golden: false,
  },
  {
    name: "chart-reports",
    surface: "docs",
    path: "/docs/how-to/chart-reports/",
    authenticated: false,
    golden: false,
  },
];

function envValue(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export function appRoutes(): AuditRoute[] {
  const guildId = envValue(
    "SCOUT_DESIGN_AUDIT_GUILD_ID",
    "1337623164146155593",
  );
  const alias = encodeURIComponent(
    envValue("SCOUT_DESIGN_AUDIT_PLAYER_ALIAS", "Scout Classic"),
  );
  const competitionId = envValue("SCOUT_DESIGN_AUDIT_COMPETITION_ID", "1");
  const reportId = envValue("SCOUT_DESIGN_AUDIT_REPORT_ID", "1");
  const prefix = `/app/g/${guildId}`;

  return [
    {
      name: "login",
      surface: "app",
      path: "/app/login",
      authenticated: false,
      golden: true,
    },
    {
      name: "guild-picker",
      surface: "app",
      path: "/app/",
      authenticated: true,
      golden: true,
    },
    {
      name: "explore",
      surface: "app",
      path: "/app/explore",
      authenticated: true,
      golden: true,
    },
    {
      name: "welcome",
      surface: "app",
      path: "/app/welcome",
      authenticated: true,
      golden: false,
    },
    {
      name: "installed",
      surface: "app",
      path: "/app/installed",
      authenticated: true,
      golden: false,
    },
    {
      name: "guild",
      surface: "app",
      path: prefix,
      authenticated: true,
      golden: true,
    },
    {
      name: "subscriptions",
      surface: "app",
      path: `${prefix}/subscriptions`,
      authenticated: true,
      golden: false,
    },
    {
      name: "players",
      surface: "app",
      path: `${prefix}/players`,
      authenticated: true,
      golden: true,
    },
    {
      name: "player-detail",
      surface: "app",
      path: `${prefix}/players/${alias}`,
      authenticated: true,
      golden: false,
    },
    {
      name: "player-manage",
      surface: "app",
      path: `${prefix}/players/${alias}/manage`,
      authenticated: true,
      golden: false,
    },
    {
      name: "competitions",
      surface: "app",
      path: `${prefix}/competitions`,
      authenticated: true,
      golden: true,
    },
    {
      name: "competition-new",
      surface: "app",
      path: `${prefix}/competitions/new`,
      authenticated: true,
      golden: false,
    },
    {
      name: "competition-detail",
      surface: "app",
      path: `${prefix}/competitions/${competitionId}`,
      authenticated: true,
      golden: true,
    },
    {
      name: "competition-edit",
      surface: "app",
      path: `${prefix}/competitions/${competitionId}/edit`,
      authenticated: true,
      golden: false,
    },
    {
      name: "reports",
      surface: "app",
      path: `${prefix}/reports`,
      authenticated: true,
      golden: true,
    },
    {
      name: "reports-help",
      surface: "app",
      path: `${prefix}/reports/help`,
      authenticated: true,
      golden: false,
    },
    {
      name: "report-new",
      surface: "app",
      path: `${prefix}/reports/new`,
      authenticated: true,
      golden: false,
    },
    {
      name: "report-detail",
      surface: "app",
      path: `${prefix}/reports/${reportId}`,
      authenticated: true,
      golden: true,
    },
    {
      name: "report-edit",
      surface: "app",
      path: `${prefix}/reports/${reportId}/edit`,
      authenticated: true,
      golden: false,
    },
    {
      name: "audit",
      surface: "app",
      path: `${prefix}/audit`,
      authenticated: true,
      golden: false,
    },
    {
      name: "access",
      surface: "app",
      path: `${prefix}/access`,
      authenticated: true,
      golden: false,
    },
  ];
}

export function auditRoutes(): AuditRoute[] {
  return [...publicRoutes, ...docsRoutes, ...appRoutes()];
}

export function routeBaseUrl(surface: AuditSurface): string {
  const localDefaults = {
    public: "http://127.0.0.1:4321",
    docs: "http://127.0.0.1:4322",
    // The backend's dev-login redirect is driven by WEB_APP_ORIGIN
    // (http://localhost:5180 per dev-web.env.tpl) and sets host-only
    // cookies, so the app surface must match that host or the
    // post-redirect browser arrives without the session cookie.
    app: "http://localhost:5180",
  } satisfies Record<AuditSurface, string>;
  const configured = {
    public: process.env["SCOUT_DESIGN_AUDIT_PUBLIC_URL"],
    docs: process.env["SCOUT_DESIGN_AUDIT_DOCS_URL"],
    app: process.env["SCOUT_DESIGN_AUDIT_APP_URL"],
  }[surface];
  return (
    configured ??
    process.env["SCOUT_DESIGN_AUDIT_BASE_URL"] ??
    localDefaults[surface]
  );
}
