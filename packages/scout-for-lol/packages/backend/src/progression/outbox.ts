export async function loadProgressionOutboxRows<Row>(
  loadActive: (take: number) => Promise<Row[]>,
  loadFailed: (take: number) => Promise<Row[]>,
): Promise<Row[]> {
  const activeRows = await loadActive(50);
  const failedRows = await loadFailed(50 - activeRows.length);
  return [...activeRows, ...failedRows];
}
