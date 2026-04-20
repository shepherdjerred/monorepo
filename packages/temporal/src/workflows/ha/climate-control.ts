export async function adjustClimate(): Promise<void> {
  console.warn("climate-control: no-op (thermostats removed from HA)");
  await Promise.resolve();
}
