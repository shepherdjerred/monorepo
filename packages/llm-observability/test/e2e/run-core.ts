export async function waitForTempo(
  ready: () => Promise<boolean>,
  attempts = 60,
  delayMilliseconds = 1000,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await ready()) return;
    await Bun.sleep(delayMilliseconds);
  }
  throw new Error(`Tempo did not become ready within ${attempts.toString()}s`);
}
