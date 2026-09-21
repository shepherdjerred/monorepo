export type AuditSurface = "public" | "docs" | "app";

export type AuditRoute = {
  name: string;
  surface: AuditSurface;
  path: string;
  authenticated: boolean;
  golden: boolean;
};

function envValue(name: string, fallback: string): string {
  return Bun.env[name] ?? fallback;
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
  const exploreConversationId = envValue(
    "SCOUT_DESIGN_AUDIT_EXPLORE_CONVERSATION_ID",
    "1b4e28ba-2fa1-41d2-883f-0016d3cca427",
  );
  const exploreShareToken = envValue(
    "SCOUT_DESIGN_AUDIT_EXPLORE_SHARE_TOKEN",
    "a".repeat(32),
  );
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
      name: "explore-conversation",
      surface: "app",
      path: `/app/explore/${exploreConversationId}`,
      authenticated: true,
      golden: false,
    },
    {
      name: "explore-shared",
      surface: "app",
      path: `/app/explore/s/${exploreShareToken}`,
      authenticated: false,
      golden: false,
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
    // Clash and Bucks are flag-gated; the fixture guild override renders them.
    {
      name: "clash",
      surface: "app",
      path: "/app/clash",
      authenticated: true,
      golden: false,
    },
    {
      name: "bucks",
      surface: "app",
      path: "/app/bucks",
      authenticated: true,
      golden: false,
    },
    {
      name: "bucks-history",
      surface: "app",
      path: "/app/bucks/history",
      authenticated: true,
      golden: false,
    },
    {
      name: "bucks-leaderboard",
      surface: "app",
      path: "/app/bucks/leaderboard",
      authenticated: true,
      golden: false,
    },
    {
      name: "bucks-settings",
      surface: "app",
      path: "/app/bucks/settings",
      authenticated: true,
      golden: false,
    },
  ];
}
