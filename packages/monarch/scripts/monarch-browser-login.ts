import { chromium } from "playwright";

const APP_URL = "https://app.monarchmoney.com/login";
const ENV_PATH = ".env";

const browser = await launchBrowser();
const context = await browser.newContext();
const page = await context.newPage();

console.log("Opening Monarch. Log in normally in the browser window.");
console.log("Waiting for a Monarch API Authorization token...");

let saved = false;
let resolveSaved: () => void;
const savedToken = new Promise<void>((resolve) => {
  resolveSaved = resolve;
});

page.on("request", async (request) => {
  if (saved) return;
  if (!request.url().startsWith("https://api.monarch.com/")) return;

  const authorization = request.headers()["authorization"];
  const match = authorization?.match(/^Token\s+(.+)$/i);
  if (!match) return;

  saved = true;
  await upsertEnvValue("MONARCH_TOKEN", match[1]);
  console.log(`Saved MONARCH_TOKEN to ${ENV_PATH}`);
  resolveSaved();
});

await page.goto(APP_URL);
await savedToken;
await browser.close();

async function upsertEnvValue(key: string, value: string): Promise<void> {
  const file = Bun.file(ENV_PATH);
  const existing = (await file.exists()) ? await file.text() : "";
  const lines = existing.split(/\r?\n/);
  const nextLine = `${key}=${value}`;
  let replaced = false;

  const nextLines = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      replaced = true;
      return nextLine;
    }
    return line;
  });

  if (!replaced) {
    if (nextLines.length > 0 && nextLines.at(-1) !== "") nextLines.push("");
    nextLines.push(nextLine);
  }

  await Bun.write(ENV_PATH, `${nextLines.join("\n").replace(/\n+$/, "")}\n`);
}

async function launchBrowser() {
  try {
    return await chromium.launch({ channel: "chrome", headless: false });
  } catch {
    return chromium.launch({ headless: false });
  }
}
