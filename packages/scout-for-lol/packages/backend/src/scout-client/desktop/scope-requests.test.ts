import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  SCOUT_DESKTOP_API_ROUTES,
  SCOUT_DESKTOP_CONTRACT_HEADER,
  ScoutDesktopApiErrorSchema,
  ScoutDesktopScopeRequestResponseSchema,
} from "@scout-for-lol/data";
import fixture from "@scout-for-lol/data/scout-client/desktop-fixtures/device-scope-requests.json" with { type: "json" };

const mocks = vi.hoisted(() => ({
  findDevice: vi.fn(),
  deviceFindUniqueOrThrow: vi.fn(),
  deviceUpdate: vi.fn(),
  pairingCreate: vi.fn(),
  pairingUpdateMany: vi.fn(),
  createContext: vi.fn(),
}));

vi.mock("#src/database/index.ts", () => ({
  prisma: {
    scoutClientDevice: {
      findUnique: mocks.findDevice,
      findUniqueOrThrow: mocks.deviceFindUniqueOrThrow,
      update: mocks.deviceUpdate,
    },
    scoutClientPairing: {
      create: mocks.pairingCreate,
      updateMany: mocks.pairingUpdateMany,
    },
  },
}));
vi.mock("#src/trpc/context.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  createContext: mocks.createContext,
}));
vi.mock("#src/trpc/auth-web-helpers.ts", () => ({
  getAppOrigin: () => "https://scout.invalid",
}));

const { handleScoutClientRoute } = await import("#src/scout-client/http.ts");
const { resetDesktopReadRateLimitForTests } = await import("./rate-limit.ts");

const PATH = SCOUT_DESKTOP_API_ROUTES.device_scope_requests.path;
const TOKEN = `sct_${"a".repeat(43)}`;
const DEVICE_ID = "4fa2a856-53af-42a4-85af-5cc085a942a3";
const REQUEST_ID = "9c1d5b0e-6f0a-4c43-8d57-2a7b1e3f4a90";

function send(
  options: {
    readonly body?: unknown;
    readonly headers?: Record<string, string>;
    readonly method?: string;
    readonly authorized?: boolean;
  } = {},
) {
  const request = new Request(`https://scout.invalid${PATH}`, {
    method: options.method ?? "POST",
    headers: {
      "Content-Type": "application/json",
      [SCOUT_DESKTOP_CONTRACT_HEADER]: "3",
      ...(options.authorized === false
        ? {}
        : { Authorization: `Bearer ${TOKEN}` }),
      ...options.headers,
    },
    body: JSON.stringify(options.body ?? fixture.request),
  });
  return handleScoutClientRoute(request, new URL(request.url));
}

async function errorCode(response: Response | null) {
  return ScoutDesktopApiErrorSchema.parse(await response?.json()).error;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDesktopReadRateLimitForTests();
  mocks.findDevice.mockResolvedValue({
    id: DEVICE_ID,
    ownerId: "160509172704739328",
    appVersion: "0.4.0",
    deviceState: "ACTIVE",
    scopes: ["ingest"],
  });
  mocks.deviceFindUniqueOrThrow.mockResolvedValue({
    deviceName: "Scout Desktop",
    platform: "windows",
    architecture: "x86_64",
    appVersion: "0.4.0",
    protocolVersion: 1,
  });
  mocks.pairingCreate.mockResolvedValue({ id: REQUEST_ID });
  mocks.pairingUpdateMany.mockResolvedValue({ count: 0 });
  mocks.createContext.mockRejectedValue(
    new Error("a scope request must not resolve a cookie session"),
  );
});

describe("POST /devices/current/scope-requests", () => {
  test("answers a pending request for the device's owner to approve", async () => {
    const response = await send();

    expect(response?.status).toBe(201);
    const body = ScoutDesktopScopeRequestResponseSchema.parse(
      await response?.json(),
    );
    expect(body.requestId).toBe(REQUEST_ID);
    expect(body.scopes).toEqual(["explore"]);
    expect(body.approvalUrl).toBe(
      `https://scout.invalid/app/scout-client/pair/${REQUEST_ID}`,
    );
    expect(response?.headers.get(SCOUT_DESKTOP_CONTRACT_HEADER)).not.toBeNull();
  });

  test("never changes the device: the request cannot grant itself a scope", async () => {
    await send();

    expect(mocks.deviceUpdate).not.toHaveBeenCalled();
    expect(mocks.pairingCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          upgradeDeviceId: DEVICE_ID,
          scopes: ["explore"],
        }),
      }),
    );
  });

  test("a device that already holds the scope is told so", async () => {
    mocks.findDevice.mockResolvedValue({
      id: DEVICE_ID,
      ownerId: "160509172704739328",
      appVersion: "0.4.0",
      deviceState: "ACTIVE",
      scopes: ["ingest", "explore"],
    });

    const response = await send();

    expect(response?.status).toBe(409);
    expect(await errorCode(response)).toBe("scope_already_granted");
    expect(mocks.pairingCreate).not.toHaveBeenCalled();
  });

  test("a browser session is not a credential here", async () => {
    const response = await send({
      authorized: false,
      headers: { Cookie: "session=anything" },
    });

    expect(response?.status).toBe(401);
    expect(await errorCode(response)).toBe("unauthorized");
    expect(mocks.createContext).not.toHaveBeenCalled();
    expect(mocks.pairingCreate).not.toHaveBeenCalled();
  });

  test("a revoked device is unauthorized", async () => {
    mocks.findDevice.mockResolvedValue({
      id: DEVICE_ID,
      ownerId: "160509172704739328",
      appVersion: "0.4.0",
      deviceState: "REVOKED",
      scopes: ["ingest"],
    });

    expect(await errorCode(await send())).toBe("unauthorized");
  });

  test.each(fixture.invalidRequests)("refuses $reason", async ({ body }) => {
    const response = await send({ body });

    expect(response?.status).toBe(400);
    expect(await errorCode(response)).toBe("invalid_request");
    expect(mocks.pairingCreate).not.toHaveBeenCalled();
  });

  test("a client older than the contract is told to update", async () => {
    const response = await send({
      headers: { [SCOUT_DESKTOP_CONTRACT_HEADER]: "0" },
    });

    expect(response?.status).toBe(426);
    expect(await errorCode(response)).toBe("contract_unsupported");
  });

  test("only POST is allowed", async () => {
    const request = new Request(`https://scout.invalid${PATH}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });

    const response = await handleScoutClientRoute(
      request,
      new URL(request.url),
    );

    expect(response?.status).toBe(405);
  });
});
