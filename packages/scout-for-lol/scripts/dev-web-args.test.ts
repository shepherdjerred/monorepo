import { expect, test } from "bun:test";
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
        "file:./agent-one.db",
      ],
      {},
    ),
  ).toEqual({
    kind: "options",
    options: {
      backendPort: 3001,
      webPort: 5181,
      databaseUrl: "file:./agent-one.db",
      discordGatewayEnabled: true,
      marketingOrigin: "http://localhost:4321",
      docsOrigin: "http://localhost:4322",
    },
  });
});

test("derives an isolated database for a non-default backend port", () => {
  expect(
    parseDevWebArgs(["--backend-port", "3001", "--web-port", "5181"], {
      DATABASE_URL: "file:./local-web-dev.db",
    }),
  ).toEqual({
    kind: "options",
    options: {
      backendPort: 3001,
      webPort: 5181,
      databaseUrl: "file:./local-web-dev-3001.db",
      discordGatewayEnabled: true,
      marketingOrigin: "http://localhost:4321",
      docsOrigin: "http://localhost:4322",
    },
  });
});

test("rejects shared ports and non-file databases", () => {
  expect(() =>
    parseDevWebArgs(["--backend-port", "3001", "--web-port", "3001"], {}),
  ).toThrow("must be different");
  expect(() =>
    parseDevWebArgs(["--database-url", "postgres://localhost/scout"], {}),
  ).toThrow("local file: SQLite URL");
});

test("supports a secondary copy without the BETA gateway", () => {
  expect(
    parseDevWebArgs(["--backend-port", "3001", "--no-discord-gateway"], {}),
  ).toEqual({
    kind: "options",
    options: {
      backendPort: 3001,
      webPort: 5180,
      databaseUrl: "file:./local-web-dev-3001.db",
      discordGatewayEnabled: false,
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
      databaseUrl: "file:./local-web-dev.db",
      discordGatewayEnabled: true,
      marketingOrigin: "http://localhost:4324",
      docsOrigin: "http://localhost:4325",
    },
  });
});
