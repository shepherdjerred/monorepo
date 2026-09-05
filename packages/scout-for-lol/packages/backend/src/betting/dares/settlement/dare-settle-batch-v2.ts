export type DareV2BatchResult<T> = {
  values: T[];
  firstFailure: { error: unknown } | null;
};

export async function collectDareV2Batch<Input, Output>(
  inputs: readonly Input[],
  run: (input: Input) => Promise<Output>,
  onError: (input: Input, error: unknown) => void,
): Promise<DareV2BatchResult<Output>> {
  const values: Output[] = [];
  let firstFailure: { error: unknown } | null = null;
  for (const input of inputs) {
    try {
      values.push(await run(input));
    } catch (error) {
      onError(input, error);
      firstFailure ??= { error };
    }
  }
  return { values, firstFailure };
}
