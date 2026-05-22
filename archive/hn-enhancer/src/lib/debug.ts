let enabled = false;

export function setDebugEnabled(value: boolean): void {
  enabled = value;
}

export function debug(category: string, ...args: unknown[]): void {
  if (enabled) {
    console.debug(`[HN Enhancer:${category}]`, ...args);
  }
}
