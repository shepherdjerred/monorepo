export function canonicalJson(value: unknown): string {
  switch (typeof value) {
    case "boolean":
    case "number":
    case "string":
      return JSON.stringify(value);
    case "object":
      if (value === null) {
        return "null";
      }
      if (Array.isArray(value)) {
        return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
      }
      return `{${Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
        .join(",")}}`;
    case "bigint":
    case "function":
    case "symbol":
    case "undefined":
      throw new Error(`unsupported canonical JSON value type: ${typeof value}`);
  }
}
