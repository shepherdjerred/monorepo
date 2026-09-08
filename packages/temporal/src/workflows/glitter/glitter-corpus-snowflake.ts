export function smallestSnowflake(ids: readonly string[]): string | undefined {
  return ids.toSorted((left, right) => {
    if (left.length !== right.length) {
      return left.length - right.length;
    }
    return left.localeCompare(right);
  })[0];
}

export function largestSnowflake(ids: readonly string[]): string | undefined {
  return ids.toSorted((left, right) => {
    if (left.length !== right.length) {
      return right.length - left.length;
    }
    return right.localeCompare(left);
  })[0];
}

export function snowflakeImmediatelyBefore(id: string): string {
  const value = BigInt(id);
  if (value === 0n) {
    throw new Error("Discord snowflake cannot be zero");
  }
  return String(value - 1n);
}
