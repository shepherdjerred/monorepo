/** Column-list renderers; names and expressions are internal constants. */
export function columnList(columns: Record<string, string>): string {
  return Object.keys(columns).join(", ");
}
