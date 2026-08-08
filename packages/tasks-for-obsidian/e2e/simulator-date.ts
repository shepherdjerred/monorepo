export function parseSimulatorToday(output: string): string {
  const today = output.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    throw new Error(`simulator returned an invalid date: ${today}`);
  }
  return today;
}
