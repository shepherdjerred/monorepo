export async function mapInBatches<Input, Output>(
  values: readonly Input[],
  batchSize: number,
  mapper: (value: Input) => Promise<Output>,
): Promise<Output[]> {
  if (!Number.isSafeInteger(batchSize) || batchSize <= 0) {
    throw new Error("Batch size must be a positive integer.");
  }
  const output: Output[] = [];
  for (let index = 0; index < values.length; index += batchSize) {
    const batch = values.slice(index, index + batchSize);
    output.push(
      ...(await Promise.all(batch.map(async (value) => mapper(value)))),
    );
  }
  return output;
}
