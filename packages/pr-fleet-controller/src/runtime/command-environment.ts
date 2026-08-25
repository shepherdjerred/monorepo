const SENSITIVE_ENVIRONMENT_NAME =
  /auth|credential|cookie|key|pass(?:word|wd)?|private|secret|token/i;

export function workerCommandEnvironment(): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(Bun.env).filter(
      ([name]) => !SENSITIVE_ENVIRONMENT_NAME.test(name),
    ),
  );
}
