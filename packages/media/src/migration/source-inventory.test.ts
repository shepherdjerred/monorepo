import { afterAll, beforeAll, expect, test } from "vitest";
import { createServer } from "node:http";
import { once } from "node:events";
import { inventoryProfiles } from "./source-inventory.ts";
import snapshot from "./fixtures/resolved-profiles.json";

let origin = "";
let requests = 0;
let drift = false;
const source = snapshot.inventories[0];
if (source === undefined) throw new Error("Missing source fixture");
const server = createServer((request, response) => {
  requests += 1;
  if (
    request.method !== "GET" ||
    request.headers["x-api-key"] !== "fixture-only"
  ) {
    response.writeHead(403).end();
    return;
  }
  const endpoint = request.url?.split("/").at(-1);
  const bodies: Record<string, unknown> = {
    qualityprofile: source.profiles,
    customformat: source.customFormats,
    qualitydefinition: source.qualityDefinitions,
    status: {
      version: drift && requests > 5 ? "changed" : source.version,
      apiKey: "must-be-stripped",
    },
    mediamanagement: {
      downloadPropersAndRepacks: source.properPreference,
      apiKey: "must-be-stripped",
    },
  };
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(bodies[endpoint ?? ""]));
});
beforeAll(async () => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Fixture server failed");
  origin = `http://127.0.0.1:${String(address.port)}`;
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
});
test("captures only whitelisted profile data, twice, through real read-only HTTP", async () => {
  requests = 0;
  const result = await inventoryProfiles({
    source: "radarr",
    baseUrl: origin,
    apiKey: "fixture-only",
  });
  expect(result).toEqual(source);
  expect(requests).toBe(10);
  expect(JSON.stringify(result)).not.toContain("must-be-stripped");
});
test("rejects configuration drift between observations", async () => {
  requests = 0;
  drift = true;
  await expect(
    inventoryProfiles({
      source: "radarr",
      baseUrl: origin,
      apiKey: "fixture-only",
    }),
  ).rejects.toThrow("settings changed during inventory");
  drift = false;
});
