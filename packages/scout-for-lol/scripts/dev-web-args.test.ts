import { expect, test } from "vitest";
import { parseDevWebArgs } from "./dev-web.ts";

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
      databaseUrl: "postgres://scout@127.0.0.1:5471/agent_one",
      discordGatewayEnabled: true,
      backendWatchEnabled: true,
      marketingOrigin: "http://localhost:4321",
      docsOrigin: "http://localhost:4322",
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
      databaseUrl: "postgres://scout@127.0.0.1:5471/scout_dev_3001",
      discordGatewayEnabled: true,
      backendWatchEnabled: true,
      marketingOrigin: "http://localhost:4321",
      docsOrigin: "http://localhost:4322",
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
      databaseUrl: "postgres://scout@127.0.0.1:5471/scout_dev_3001",
      discordGatewayEnabled: false,
      backendWatchEnabled: false,
      marketingOrigin: "http://localhost:4321",
      docsOrigin: "http://localhost:4322",
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
      databaseUrl: "postgres://scout@127.0.0.1:5471/scout_dev_3000",
      discordGatewayEnabled: true,
      backendWatchEnabled: true,
      marketingOrigin: "http://localhost:4324",
      docsOrigin: "http://localhost:4325",
    },
  });
});
