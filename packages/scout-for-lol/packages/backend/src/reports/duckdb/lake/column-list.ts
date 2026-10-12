/** Column-list renderers; names and expressions are internal constants. */
export function columnList(columns: Record<string, string>): string {
  return Object.keys(columns).join(", ");
}

export function parquetColumnList(
  columns: Record<string, string>,
  expressions: Record<string, string> | undefined,
): string {
  return Object.entries(columns)
    .map(([name]) => {
      const expression = expressions?.[name];
      return expression === undefined ? name : `${expression} AS ${name}`;
    })
    .join(", ");
}
