export function readPositiveIntegerEnv(input: {
  name: string;
  defaultValue: number;
}): number {
  if (!Number.isInteger(input.defaultValue) || input.defaultValue < 1) {
    throw new Error(
      `${input.name} default must be a positive integer; got ${input.defaultValue.toString()}`,
    );
  }

  const rawValue = Bun.env[input.name];
  if (rawValue === undefined || rawValue.trim() === "") {
    return input.defaultValue;
  }

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(
      `${input.name} must be a positive integer; got ${rawValue}`,
    );
  }
  return value;
}
