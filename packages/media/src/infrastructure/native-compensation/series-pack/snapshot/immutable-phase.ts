/** Seal only the already validated data owned by one held phase. This is not a
 * database cache: the actual parents, locks, allowance and deadlines stay with
 * their original transaction. Dates need an explicit guard because freezing a
 * Date does not freeze its internal timestamp. */
export function sealSeriesPackNativePhaseDataV1(value: unknown) {
  const seen = new WeakSet<object>();
  const dates: { value: Date; time: number }[] = [];
  function seal(item: unknown) {
    if (typeof item === "function" || typeof item === "symbol")
      throw new TypeError("Native phase parents must be validated data");
    if (item === null || typeof item !== "object" || seen.has(item)) return;
    seen.add(item);
    if (item instanceof Date) {
      const time = item.getTime();
      if (!Number.isFinite(time))
        throw new TypeError("Native phase parent timestamp is invalid");
      dates.push({ value: item, time });
    } else {
      const prototype: unknown = Object.getPrototypeOf(item);
      if (
        prototype !== null &&
        prototype !== Object.prototype &&
        prototype !== Array.prototype
      )
        throw new TypeError("Native phase parents must be validated data");
      for (const child of Object.values(item)) seal(child);
    }
    Object.freeze(item);
  }
  seal(value);
  return () => {
    if (dates.some((date) => date.value.getTime() !== date.time))
      throw new Error(
        "Native phase parent timestamps changed after validation",
      );
  };
}
