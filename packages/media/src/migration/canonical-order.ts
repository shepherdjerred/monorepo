/** UTF-16 code-unit order is deterministic across locales and supported JS runtimes. */
export function canonicalOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
