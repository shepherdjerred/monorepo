/** Capacity bytes arrive as validated decimal strings; retain every digit. */
export function capacityBytes(value: string): string {
  return `${BigInt(value).toLocaleString("en-US")} bytes`;
}
