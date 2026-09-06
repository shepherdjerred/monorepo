import { expect, test } from "vitest";
import { parseDevWebArgs } from "./dev-web.ts";
import {
  resolveBackendEntrypoint,
  shouldPrepareReportLake,
} from "./dev-web.ts";
import { buildDevEnvironment } from "./dev-web-environment.ts";

test("parses isolated ports and database URL", () => {
  expect(
    parseDevWebArgs(
      [
        "--backend-port",
        "3001",
        "--web-port",
        "5181",
        "--database-url",
        "postgres://scout@127.0.0.1:5471/agent_one",
      ],
      {},
    ),
  ).toEqual({
    kind: "options",
    options: {
      backendPort: 3001,
      webPort: 5181,
      temporalPort: 7234,
      temporalUiPort: 8234,
      databaseUrl: "postgres://scout@127.0.0.1:5471/agent_one",
      discordGatewayEnabled: true,
      backgroundJobsEnabled: true,
      webEnabled: true,
      backendWatchEnabled: true,
      marketingOrigin: "http://localhost:4321",
      docsOrigin: "http://localhost:4322",
      authMode: "dev-login",
      consumerPreview: true,
      consumerGuildId: "1337623164146155593",
    },
  });
});

test("derives an isolated database for a non-default backend port", () => {
  expect(
    parseDevWebArgs(["--backend-port", "3001", "--web-port", "5181"], {
      DATABASE_URL: "postgres://scout@127.0.0.1:5471/scout_dev_3000",
    }),
  ).toEqual({
    kind: "options",
    options: {
      backendPort: 3001,
      webPort: 5181,
      temporalPort: 7234,
      temporalUiPort: 8234,
      databaseUrl: "postgres://scout@127.0.0.1:5471/scout_dev_3001",
      discordGatewayEnabled: true,
      backgroundJobsEnabled: true,
      webEnabled: true,
      backendWatchEnabled: true,
      marketingOrigin: "http://localhost:4321",
      docsOrigin: "http://localhost:4322",
      authMode: "dev-login",
      consumerPreview: true,
      consumerGuildId: "1337623164146155593",
    },
  });
});

test("rejects shared ports and sqlite databases", () => {
  expect(() =>
    parseDevWebArgs(["--backend-port", "3001", "--web-port", "3001"], {}),
  ).toThrow("must be different");
  expect(() =>
    parseDevWebArgs(["--database-url", "file:./local-web-dev.db"], {}),
  ).toThrow("postgres:// URL");
});

test("supports a stable secondary copy without the BETA gateway", () => {
  expect(
    parseDevWebArgs(
      ["--backend-port", "3001", "--no-discord-gateway", "--no-backend-watch"],
      {},
    ),
  ).toEqual({
    kind: "options",
    options: {
      backendPort: 3001,
      webPort: 5180,
      temporalPort: 7234,
      temporalUiPort: 8234,
      databaseUrl: "postgres://scout@127.0.0.1:5471/scout_dev_3001",
      discordGatewayEnabled: false,
      backgroundJobsEnabled: true,
      webEnabled: true,
      backendWatchEnabled: false,
      marketingOrigin: "http://localhost:4321",
      docsOrigin: "http://localhost:4322",
      authMode: "dev-login",
      consumerPreview: true,
      consumerGuildId: "1337623164146155593",
    },
  });
});

test("configures alternate surface origins for a second stack", () => {
  expect(
    parseDevWebArgs(
      [
        "--marketing-origin",
        "http://localhost:4324/",
        "--docs-origin",
        "http://localhost:4325",
      ],
      {},
    ),
  ).toEqual({
    kind: "options",
    options: {
      backendPort: 3000,
      webPort: 5180,
      temporalPort: 7233,
      temporalUiPort: 8233,
      databaseUrl: "postgres://scout@127.0.0.1:5471/scout_dev_3000",
      discordGatewayEnabled: true,
      backgroundJobsEnabled: true,
      webEnabled: true,
      backendWatchEnabled: true,
      marketingOrigin: "http://localhost:4324",
      docsOrigin: "http://localhost:4325",
      authMode: "dev-login",
      consumerPreview: true,
      consumerGuildId: "1337623164146155593",
    },
  });
});

test("defaults a local boot to the consumer preview and dev login", () => {
  const parsed = parseDevWebArgs([], {
    ENVIRONMENT: "dev",
    DATABASE_URL: "postgres://scout@127.0.0.1:5471/scout_dev_3000",
  });

  expect(parsed.kind).toBe("options");
  if (parsed.kind !== "options") return;

  const environment = buildDevEnvironment(
    {},
    parsed.options,
    "/tmp/scout-report-lake",
    false,
  );

  expect(environment).toMatchObject({
    ENABLE_DEV_LOGIN: "true",
    DEV_AUTH_MODE: "dev-login",
    DEV_USER_GUILDS: "1337623164146155593",
    EXPLORE_GUILD_ALLOWLIST: "1337623164146155593",
    FEATURE_FLAGS_MODE: "static",
    FEATURE_FLAGS_STATIC_OVERRIDES:
      '{"scout-consumer-player-profiles-enabled":true}',
    WEB_APP_ORIGIN: "http://localhost:5180",
  });
});

test("uses valid Temporal release metadata for design-audit boot", () => {
  const parsed = parseDevWebArgs([], {});

  expect(parsed.kind).toBe("options");
  if (parsed.kind !== "options") return;

  expect(
    buildDevEnvironment({}, parsed.options, "/tmp/scout-report-lake", true),
  ).toMatchObject({
    GIT_SHA: "0000000000000000000000000000000000000000",
    NODE_ENV: "test",
  });
});

test("preserves explicit local access and auth overrides", () => {
  const parsed = parseDevWebArgs([], {
    SCOUT_DEV_AUTH_MODE: "oauth",
    SCOUT_DEV_CONSUMER_PREVIEW: "false",
    SCOUT_DEV_CONSUMER_GUILD_ID: "1337623164146155593",
    FEATURE_FLAGS_MODE: "disabled",
    FEATURE_FLAGS_STATIC_OVERRIDES:
      '{"scout-consumer-player-profiles-enabled":false}',
    DEV_USER_GUILDS: "",
    EXPLORE_GUILD_ALLOWLIST: "",
  });

  expect(parsed.kind).toBe("options");
  if (parsed.kind !== "options") return;

  const environment = buildDevEnvironment(
    {
      FEATURE_FLAGS_MODE: "disabled",
      FEATURE_FLAGS_STATIC_OVERRIDES:
        '{"scout-consumer-player-profiles-enabled":false}',
      DEV_USER_GUILDS: "",
      EXPLORE_GUILD_ALLOWLIST: "",
    },
    parsed.options,
    "/tmp/scout-report-lake",
    false,
  );

  expect(environment).toMatchObject({
    ENABLE_DEV_LOGIN: "false",
    DEV_AUTH_MODE: "oauth",
    DEV_USER_GUILDS: "",
    EXPLORE_GUILD_ALLOWLIST: "",
    FEATURE_FLAGS_MODE: "disabled",
    FEATURE_FLAGS_STATIC_OVERRIDES:
      '{"scout-consumer-player-profiles-enabled":false}',
  });
});

test("supports a gateway-only runtime without jobs, lake preparation, or Vite", () => {
  const parsed = parseDevWebArgs(
    ["--no-background-jobs", "--no-web", "--no-backend-watch"],
    {},
  );
  expect(parsed.kind).toBe("options");
  if (parsed.kind !== "options") return;

  expect(parsed.options).toMatchObject({
    discordGatewayEnabled: true,
    backgroundJobsEnabled: false,
    webEnabled: false,
    backendWatchEnabled: false,
  });
  expect(shouldPrepareReportLake(parsed.options, false)).toBe(false);
  expect(
    buildDevEnvironment({}, parsed.options, "/unused/report-lake", false),
  ).toMatchObject({
    ENABLE_DISCORD_GATEWAY: "true",
    ENABLE_BACKGROUND_JOBS: "false",
  });
});

test("allows only the normal and Discord smoke backend entrypoints", () => {
  expect(resolveBackendEntrypoint({})).toBe("src/index.ts");
  expect(
    resolveBackendEntrypoint({
      SCOUT_DEV_BACKEND_ENTRYPOINT: "src/dev-discord.ts",
    }),
  ).toBe("src/dev-discord.ts");
  expect(() =>
    resolveBackendEntrypoint({ SCOUT_DEV_BACKEND_ENTRYPOINT: "src/other.ts" }),
  ).toThrow("must be src/index.ts or src/dev-discord.ts");
});
