// Share only an identical complete semantic cache key. Failures are delivered
// to every waiter and cleared; no caller receives a partial export or receipt.
export function createAnimationSingleFlight() {
  const pending = new Map();
  return async (key, prepare) => {
    if (typeof key !== "string" || !/^[a-f\d]{64}$/.test(key))
      throw Error("Complete animation export cache key required");
    if (pending.has(key)) return pending.get(key);
    const work = Promise.resolve().then(prepare);
    pending.set(key, work);
    try {
      return await work;
    } finally {
      if (pending.get(key) === work) pending.delete(key);
    }
  };
}
