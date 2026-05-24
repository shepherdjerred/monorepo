import { chromium, type Browser } from "playwright";
import { saveMonarchSession } from "../src/lib/monarch/session.ts";

const APP_URL = "https://app.monarch.com/login";

type CapturedHeaders = {
  origin?: string;
  referer?: string;
  "user-agent"?: string;
  "x-csrftoken"?: string;
  "monarch-client"?: string;
  "monarch-client-version"?: string;
};

const browser = await launchBrowser();
const context = await browser.newContext();
const page = await context.newPage();

console.log("Opening Monarch. Log in normally in the browser window.");
console.log("Waiting for a Monarch GraphQL session...");

let saved = false;
let saving = false;
let capturedHeaders: CapturedHeaders = {};
let resolveSaved: () => void;
let rejectSaved: (error: Error) => void;
const savedSession = new Promise<void>((resolve, reject) => {
  resolveSaved = resolve;
  rejectSaved = reject;
});

page.on("request", async (request) => {
  if (saved || saving) return;
  if (request.method() !== "POST") return;
  if (request.url() !== "https://api.monarch.com/graphql") return;

  saving = true;
  const headers = request.headers();
  capturedHeaders = pickHeaders(headers);

  try {
    const cookies = await context.cookies([
      "https://api.monarch.com",
      "https://app.monarch.com",
    ]);
    const hasCsrf =
      capturedHeaders["x-csrftoken"] !== undefined ||
      cookies.some((cookie) => cookie.name === "csrftoken");
    const hasSession = cookies.some(
      (cookie) => cookie.name === "sessionid" || cookie.name === "session_id",
    );

    if (!hasCsrf || !hasSession) {
      saving = false;
      return;
    }

    saved = true;
    await saveMonarchSession({
      createdAt: new Date().toISOString(),
      cookies,
      headers: compactHeaders(capturedHeaders),
    });
    console.log("Saved Monarch session to .monarch-session.json");
    resolveSaved();
  } catch (error: unknown) {
    saving = false;
    const message = error instanceof Error ? error.message : String(error);
    rejectSaved(new Error(message));
  }
});

await page.goto(APP_URL);
await savedSession;
await browser.close();

function pickHeaders(headers: Record<string, string>): CapturedHeaders {
  return {
    origin: headers.origin,
    referer: headers.referer,
    "user-agent": headers["user-agent"],
    "x-csrftoken": headers["x-csrftoken"],
    "monarch-client": headers["monarch-client"],
    "monarch-client-version": headers["monarch-client-version"],
  };
}

function compactHeaders(headers: CapturedHeaders): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined && value !== "") {
      result[key] = value;
    }
  }
  return result;
}

async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ channel: "chrome", headless: false });
  } catch {
    return chromium.launch({ headless: false });
  }
}
