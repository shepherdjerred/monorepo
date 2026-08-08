const timeoutMs = 300_000;
const retryDelayMs = 5000;
const endpoint =
  "https://matomo.sjer.red/matomo.php?module=API&method=API.getMatomoVersion&format=json";
const deadline = Date.now() + timeoutMs;
let lastStatus = "no response";
let ready = false;

while (Date.now() < deadline) {
  try {
    const response = await fetch(endpoint, { redirect: "error" });
    const body = await response.text();
    if (response.ok && body.trim().length > 0) {
      console.log(`Matomo is ready at ${endpoint}`);
      ready = true;
      break;
    }
    lastStatus = `${String(response.status)} ${body.slice(0, 120)}`;
  } catch (error) {
    lastStatus = error instanceof Error ? error.message : String(error);
  }

  await Bun.sleep(retryDelayMs);
}

if (!ready) {
  throw new Error(
    `Matomo did not pass the public cutover check within ${String(timeoutMs / 1000)}s: ${lastStatus}`,
  );
}
