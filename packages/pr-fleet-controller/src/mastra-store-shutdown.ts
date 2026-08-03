type CleanupStep = () => Promise<void>;

async function captureCleanupFailure(
  step: CleanupStep,
  failures: unknown[],
): Promise<void> {
  try {
    await step();
  } catch (error) {
    failures.push(error);
  }
}

export async function shutdownMastraStores(options: {
  shutdownMastra: CleanupStep;
  secureArtifacts: CleanupStep;
  closeDuckdb: CleanupStep;
  closeLibsql: CleanupStep;
}): Promise<void> {
  const failures: unknown[] = [];
  await captureCleanupFailure(options.shutdownMastra, failures);
  await captureCleanupFailure(options.secureArtifacts, failures);
  await Promise.all([
    captureCleanupFailure(options.closeDuckdb, failures),
    captureCleanupFailure(options.closeLibsql, failures),
  ]);
  if (failures.length > 0) {
    throw new AggregateError(failures, "Failed to shut down Mastra storage");
  }
}
