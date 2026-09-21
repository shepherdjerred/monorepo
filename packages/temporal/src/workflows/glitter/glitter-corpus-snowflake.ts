export function smallestSnowflake(ids: readonly string[]): string | undefined {
  return ids.toSorted((left, right) => {
    return left.length === right.length
      ? left.localeCompare(right)
      : left.length - right.length;
  })[0];
}

export function largestSnowflake(ids: readonly string[]): string | undefined {
  return ids.toSorted((left, right) => {
    return left.length === right.length
      ? right.localeCompare(left)
      : right.length - left.length;
  })[0];
}

export function snowflakeImmediatelyBefore(id: string): string {
  const value = BigInt(id);
  if (value === 0n) {
    throw new Error("Discord snowflake cannot be zero");
  }
  return String(value - 1n);
}
