/** Phase messages stay on stderr so stdout remains a single machine-readable result. */
export async function phase<T>(
  name: string,
  action: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  process.stderr.write(`[capture] ${name}\n`);
  try {
    const result = await action();
    process.stderr.write(
      `[capture] ${name}: complete (${((performance.now() - started) / 1000).toFixed(1)}s)\n`,
    );
    return result;
  } catch (error) {
    process.stderr.write(
      `[capture] ${name}: failed (${((performance.now() - started) / 1000).toFixed(1)}s)\n`,
    );
    throw error;
  }
}
