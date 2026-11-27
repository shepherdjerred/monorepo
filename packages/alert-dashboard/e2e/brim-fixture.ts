import { HistorySessionsSchema } from "#modules/brim/schema.ts";
import { createBrimServerModule } from "#modules/brim/server.ts";

function historyFixture(name: string): Promise<unknown> {
  return Bun.file(
    new URL(
      `../../toolkit/schemas/fixtures/history-api-${name}.json`,
      import.meta.url,
    ),
  ).json();
}

export async function createBrimFixtureModule() {
  const [blocks, capture, captures, facets, session, sessionsPayload, usage] =
    await Promise.all([
      historyFixture("blocks"),
      historyFixture("capture-detail"),
      historyFixture("captures"),
      historyFixture("facets"),
      historyFixture("session-detail"),
      historyFixture("sessions"),
      historyFixture("usage-report"),
    ]);
  const sessions = HistorySessionsSchema.parse(sessionsPayload);
  const now = Date.now() / 1000 - 978_307_200;
  const snapshot = {
    accountLabel: "Personal",
    plan: { name: "Pro", monthlyCostUSD: 20 },
    sourceTimestamp: now - 120,
    windows: [
      {
        id: "5h",
        label: "5-hour window",
        usedPercent: 62,
        resetAt: now + 3600,
      },
    ],
    resets: [{ exp: now + 4 * 86_400 }],
  };
  const overview = {
    version: 1,
    collector: {
      device: "macbook",
      collectedAt: now - 120,
      expiresAt: now + 300,
    },
    quotas: [
      { provider: "codex", status: "current", snapshot },
      { provider: "claude-code", status: "sign_in_required" },
    ],
    billing: [
      {
        platform: "openai",
        status: "current",
        snapshot: {
          monthlySpend: 12.3,
          projectedSpend: 21.5,
          workspaceNames: ["Personal"],
          sourceTimestamp: now - 120,
        },
      },
    ],
    quotaHistory: [33, 48, 62].map((usedPercent, index) => ({
      provider: "codex",
      windowID: "5h",
      label: "5-hour window",
      usedPercent,
      recordedAt: now - 7200 + index * 3600,
    })),
    archive: {
      lastSuccessfulSyncAt: new Date().toISOString(),
      devices: ["MacBook", "Karpathy", "Windows"].map((displayName) => ({
        machineId: displayName.toLowerCase(),
        displayName,
        lastArchivedAt: new Date().toISOString(),
        lastIndexedAt: new Date().toISOString(),
      })),
    },
  };
  const payloads = new Map<string, unknown>([
    ["/healthz", { status: "ok" }],
    ["/v1/overview", overview],
    [
      "/v1/priorities",
      {
        version: 1,
        priorities: [
          {
            coreId: "core-one",
            terminalId: "t42",
            machineName: "Karpathy",
            title: "Check Brim sync",
            priority: "p1",
            updatedAt: new Date().toISOString(),
          },
        ],
      },
    ],
    ["/v1/history/sessions", sessionsPayload],
    ["/v1/history/sessions/42", session],
    ["/v1/history/captures", captures],
    ["/v1/history/captures/5", capture],
    ["/v1/history/facets", facets],
    ["/v1/history/usage", usage],
    ["/v1/history/blocks", blocks],
  ]);
  return createBrimServerModule({
    origin: "http://brim.fixture",
    token: "local-fixture-only",
    authorize: () => Promise.resolve(null),
    fetch: Object.assign(
      (input: URL | RequestInfo) => {
        const url = new URL(input instanceof Request ? input.url : input);
        if (url.pathname === "/v1/history/search") {
          const q = url.searchParams.get("q")?.toLowerCase() ?? "";
          return Promise.resolve(
            Response.json({
              ...sessions,
              sessions: sessions.sessions.filter((row) =>
                row.title.toLowerCase().includes(q),
              ),
            }),
          );
        }
        const payload = payloads.get(url.pathname);
        return Promise.resolve(
          payload === undefined
            ? Response.json({ error: "Not found" }, { status: 404 })
            : Response.json(payload),
        );
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  });
}
