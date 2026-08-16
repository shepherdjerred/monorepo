export function createKeyedSerialExecutor() {
  const operationTails = new Map<string, Promise<undefined>>();

  return async function runSerial<T>(
    key: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = operationTails.get(key) ?? Promise.resolve(undefined);
    const turn = Promise.withResolvers<undefined>();
    operationTails.set(key, turn.promise);
    await previous;
    try {
      return await operation();
    } finally {
      turn.resolve(undefined);
      if (operationTails.get(key) === turn.promise) operationTails.delete(key);
    }
  };
}
