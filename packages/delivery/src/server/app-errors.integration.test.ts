import { afterAll, beforeAll, expect, test } from "vitest";
import { createTestDatabase } from "#testing/postgres.ts";
import { Delivery } from "#infrastructure/delivery.ts";
import { createTestApp } from "#testing/http-app.ts";
import { createRequestLoad } from "./request-load.ts";

const TRANSIENT_CODES = ["P1017", "P2024", "P2028", "P2034"];

let cluster: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createTestApp>;
let slowApp: ReturnType<typeof createTestApp>;
let clock = 0;
const slowLines: string[] = [];

beforeAll(async () => {
  cluster = await createTestDatabase();
  app = createTestApp(new Delivery(cluster.database), {
    machineCredentials: [],
    writesEnabled: async () => true,
    enabledEnvironments: async () => [],
  });
  // Registered before the first request builds the matcher.
  app.post("/unique-violation-probe", () => {
    throw Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
    });
  });
  app.post("/prisma-failure-probe", () => {
    throw prismaFailure("P2003", {
      modelName: "BuildArtifactSelection",
      field_name: "BuildArtifactSelection_artifactId_fkey",
      value: "must-not-be-logged",
    });
  });
  slowApp = createTestApp(
    new Delivery(cluster.database),
    {
      machineCredentials: [],
      writesEnabled: async () => true,
      enabledEnvironments: async () => [],
    },
    undefined,
    {
      load: createRequestLoad({
        log: (line) => slowLines.push(line),
        now: () => clock,
      }),
    },
  );
  slowApp.post("/slow-probe/:id", (c) => {
    clock += 5000;
    return c.json({ ok: true });
  });
  for (const code of TRANSIENT_CODES)
    app.post(`/transient-${code}-probe`, () => {
      throw prismaFailure(code, {});
    });
}, 60_000);

afterAll(async () => {
  await cluster.close();
});

function prismaFailure(code: string, meta: unknown) {
  return Object.assign(new Error("Invalid `prisma.build.create()` call"), {
    name: "PrismaClientKnownRequestError",
    code,
    meta,
  });
}

/**
 * The log line of a 500 had only the error type, so a Prisma failure on the
 * Delivery publish path could not be told from any other (FM-184).
 */
test("an unexpected Prisma failure answers 500 and logs its code, route and the schema objects it names", async () => {
  const lines: string[] = [];
  const original = console.error;
  console.error = (line: string) => lines.push(line);
  try {
    const response = await app.request("/prisma-failure-probe", {
      method: "POST",
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: { code: "INTERNAL", message: "Delivery request failed" },
    });
  } finally {
    console.error = original;
  }
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0] ?? "")).toMatchObject({
    message: "delivery_request_failed",
    method: "POST",
    route: "/prisma-failure-probe",
    errorType: "PrismaClientKnownRequestError",
    code: "P2003",
    meta: {
      modelName: "BuildArtifactSelection",
      field_name: "BuildArtifactSelection_artifactId_fkey",
    },
  });
  expect(lines[0]).not.toContain("must-not-be-logged");
});

test.each(TRANSIENT_CODES)(
  "a transient database failure (%s) answers 503 UNAVAILABLE so a caller can retry",
  async (code) => {
    const original = console.error;
    console.error = () => {
      // The failure's log line is not under test here.
    };
    try {
      const response = await app.request(`/transient-${code}-probe`, {
        method: "POST",
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        error: { code: "UNAVAILABLE" },
      });
    } finally {
      console.error = original;
    }
  },
);

/**
 * A concurrent duplicate, such as a second pending recovery intent for one
 * deployment, answered HTTP 500 INTERNAL before (AI-423).
 */
test("a unique-constraint violation answers 409 CONFLICT, not 500", async () => {
  const response = await app.request("/unique-violation-probe", {
    method: "POST",
  });
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    error: { code: "CONFLICT" },
  });
});

test("a request that runs long is logged by route shape, without its identifiers", async () => {
  const response = await slowApp.request(
    "/slow-probe/0f8fad5b-d9cb-469f-a165-70867728950e?token=secret",
    { method: "POST" },
  );
  expect(response.status).toBe(200);
  expect(slowLines).toHaveLength(1);
  const logged = JSON.parse(slowLines[0] ?? "");
  expect(logged).toMatchObject({
    message: "delivery_slow_request",
    route: "POST /slow-probe/:id",
    ms: 5000,
  });
  expect(slowLines[0]).not.toContain("secret");
});
