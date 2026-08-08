/**
 * Test setup file - sets environment variables before any other imports
 * This must be loaded before the test file to ensure Prisma Client
 * is initialized with the correct database URL
 */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll } from "bun:test";
import { z } from "zod";

const PINCHTAB_TOKEN = "test-pinchtab-token";
const SCREENSHOT_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const ProfileStartRequestSchema = z.object({
  headless: z.boolean(),
  viewport: z.object({
    width: z.number(),
    height: z.number(),
  }),
});

const OpenTabRequestSchema = z.object({
  url: z.string(),
});

const NavigateRequestSchema = z.object({
  url: z.string(),
});

const PageActionRequestSchema = z.object({
  action: z.string(),
  selector: z.string().optional(),
  text: z.string().optional(),
  key: z.string().optional(),
  pressEnter: z.boolean().optional(),
});

function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

async function parseRequest<T>(request: Request, schema: z.ZodType<T>) {
  const body: unknown = await request.json();
  return schema.safeParse(body);
}

async function startFakeProfile(
  request: Request,
  profile: string,
): Promise<Response> {
  const body = await parseRequest(request, ProfileStartRequestSchema);
  if (!body.success) {
    return jsonResponse({ error: "invalid profile start request" }, 400);
  }
  return jsonResponse({ instanceId: `instance-${profile}` });
}

async function openFakeTab(
  request: Request,
  instanceId: string,
): Promise<Response> {
  const body = await parseRequest(request, OpenTabRequestSchema);
  if (!body.success) {
    return jsonResponse({ error: "invalid tab open request" }, 400);
  }
  return jsonResponse({ tabId: `tab-${instanceId}`, url: body.data.url });
}

async function navigateFakeTab(request: Request): Promise<Response> {
  const body = await parseRequest(request, NavigateRequestSchema);
  if (!body.success) {
    return jsonResponse({ error: "invalid navigate request" }, 400);
  }
  return jsonResponse({
    title: "Example Domain",
    url: body.data.url,
  });
}

async function performFakePageAction(request: Request): Promise<Response> {
  const body = await parseRequest(request, PageActionRequestSchema);
  if (!body.success) {
    return jsonResponse({ error: "invalid page action request" }, 400);
  }
  if (body.data.action === "type" && body.data.selector === "input[name='q']") {
    return jsonResponse({ error: "selector not found" }, 422);
  }
  return jsonResponse({ completed: true });
}

async function handleFakePinchtabRequest(request: Request): Promise<Response> {
  if (request.headers.get("authorization") !== `Bearer ${PINCHTAB_TOKEN}`) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const url = new URL(request.url);
  const segments = url.pathname.split("/").filter((segment) => segment !== "");
  const route = [
    request.method,
    segments[0] ?? "",
    segments.at(-1) ?? "",
    String(segments.length),
  ].join(":");

  switch (route) {
    case "POST:profiles:start:3":
      return await startFakeProfile(request, segments[1] ?? "");
    case "POST:instances:open:4":
      return await openFakeTab(request, segments[1] ?? "");
    case "POST:tabs:navigate:3":
      return await navigateFakeTab(request);
    case "GET:tabs:text:3":
      return jsonResponse({
        text: "Example Domain\nFake PinchTab page content",
      });
    case "GET:tabs:screenshot:3":
      return new Response(SCREENSHOT_BYTES, {
        headers: { "content-type": "image/png" },
      });
    case "POST:tabs:action:3":
      return await performFakePageAction(request);
    case "POST:tabs:close:3":
      return jsonResponse({ closed: true });
    default:
      return jsonResponse({ error: "not found" }, 404);
  }
}

const fakePinchtabServer = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: handleFakePinchtabRequest,
});

let temporaryTestDatabaseDirectory: string | undefined;

afterAll(async () => {
  await fakePinchtabServer.stop(true);
  if (temporaryTestDatabaseDirectory !== undefined) {
    await rm(temporaryTestDatabaseDirectory, { recursive: true, force: true });
  }
});

// Set up minimal test environment
// Only set defaults if not already set (allows CI to override)
Bun.env["DISCORD_TOKEN"] ??= "test-token";
Bun.env["DISCORD_CLIENT_ID"] ??= "123456789012345678";
Bun.env["OPENAI_API_KEY"] ??= "test-key";
Bun.env["SHELL_ENABLED"] ??= "true";
Bun.env["SCHEDULER_ENABLED"] ??= "true";
Bun.env["BROWSER_ENABLED"] = "true";
Bun.env["BROWSER_HEADLESS"] ??= "true";
Bun.env["BROWSER_PROVIDER"] = "pinchtab";
Bun.env["PINCHTAB_BASE_URL"] = fakePinchtabServer.url.origin;
Bun.env["PINCHTAB_TOKEN"] = PINCHTAB_TOKEN;
Bun.env["PINCHTAB_PROFILE"] = "test-profile";

// A nested `bun test` inherits its parent's environment. Give every test
// process its own database so a child cannot recreate a database while the
// parent still has an open Prisma client for it.
const currentProcessId = String(process.pid);
const databaseOwnerProcessId = Bun.env["BIRMEL_TEST_DATABASE_OWNER_PID"];
if (
  databaseOwnerProcessId !== undefined &&
  databaseOwnerProcessId !== currentProcessId
) {
  delete Bun.env["DATABASE_PATH"];
  delete Bun.env["DATABASE_URL"];
}
Bun.env["BIRMEL_TEST_DATABASE_OWNER_PID"] = currentProcessId;

if (Bun.env["DATABASE_PATH"] == null || Bun.env["DATABASE_PATH"].length === 0) {
  temporaryTestDatabaseDirectory = await mkdtemp(
    path.join(tmpdir(), "birmel-test-"),
  );
  Bun.env["DATABASE_PATH"] = path.join(
    temporaryTestDatabaseDirectory,
    "birmel.db",
  );
}

// Create screenshots directory
const screenshotsDir =
  Bun.env["BIRMEL_SCREENSHOTS_DIR"] ??
  path.join(process.cwd(), "data", "screenshots");
await mkdir(screenshotsDir, { recursive: true });
Bun.env["BIRMEL_SCREENSHOTS_DIR"] ??= screenshotsDir;

// Resolve database path to absolute (Prisma 6.x ignores relative SQLite paths)
const rawDbPath = Bun.env["DATABASE_PATH"] ?? "";
const strippedPath = rawDbPath.startsWith("file:")
  ? rawDbPath.replace("file:", "")
  : rawDbPath;
const normalizedDbPath = strippedPath
  ? path.resolve(process.cwd(), strippedPath)
  : "";
if (normalizedDbPath) {
  Bun.env["DATABASE_PATH"] = normalizedDbPath;
  Bun.env["DATABASE_URL"] = `file:${normalizedDbPath}`;
  await mkdir(path.dirname(normalizedDbPath), { recursive: true });
  // Remove stale test database so tests start with a clean slate
  await rm(normalizedDbPath, { force: true });
}

// Apply the same versioned migrations used by runtime startup.
// Keep the child environment minimal because Prisma's schema engine can fail
// when it inherits agent/tooling-specific variables from the parent process.
const migrationDeploy = spawnSync("bunx", ["prisma", "migrate", "deploy"], {
  stdio: "pipe",
  env: {
    HOME: Bun.env["HOME"] ?? "",
    PATH: Bun.env["PATH"] ?? "",
    TMPDIR: Bun.env["TMPDIR"] ?? "",
    BUN_INSTALL_CACHE_DIR: Bun.env["BUN_INSTALL_CACHE_DIR"] ?? "",
    DATABASE_URL: `file:${normalizedDbPath}`,
  },
});

if (migrationDeploy.status !== 0) {
  throw new Error(
    [
      "Failed to deploy Prisma test migrations.",
      migrationDeploy.stdout.toString().trim(),
      migrationDeploy.stderr.toString().trim(),
    ]
      .filter((part) => part.length > 0)
      .join("\n\n"),
  );
}
