/** Required internal contracts fail at their source instead of rendering corrupt data. */
export function defined<T>(value: T | null | undefined): T {
  if (value === undefined || value === null)
    throw new Error("Missing required reader data");
  return value;
}
