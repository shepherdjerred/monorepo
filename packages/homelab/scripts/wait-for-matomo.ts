const timeoutMs = 300_000;
const retryDelayMs = 5000;
// matomo.php is the public tracking endpoint; rec=0 returns its pixel without
// recording a pageview. The API front controller is index.php and requires auth.
const endpoint = "https://matomo.sjer.red/matomo.php?idsite=1&rec=0";
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
