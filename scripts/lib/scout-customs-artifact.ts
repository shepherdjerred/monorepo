export type ScoutSiteFlavor = "prod" | "beta";

export async function assertScoutCustomsArtifactPolicy(
  directory: string,
  flavor: ScoutSiteFlavor,
): Promise<void> {
  const index = Bun.file(`${directory}/customs/index.html`);
  const exists = await index.exists();
  if (flavor === "beta") {
    if (!exists) {
      throw new Error("Beta Scout archive is missing customs/index.html");
    }
    if (index.size < 100) {
      throw new Error(
        `Beta Customs index is suspiciously small (${index.size.toString()} bytes)`,
      );
    }
    return;
  }
  if (exists) {
    throw new Error("Production Scout archive contains forbidden Customs UI");
  }
}
