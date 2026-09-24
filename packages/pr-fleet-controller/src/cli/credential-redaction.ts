/**
 * Provider credentials visible to this process, for run-bundle redaction.
 *
 * Its own module because `main.ts` is at its line ceiling, and because the set
 * of names is the thing that changes: one gateway key became three provider
 * keys, and a bundle that leaks any of them is as bad as one that leaked the
 * old one.
 */
const REDACTED_CREDENTIAL_NAMES = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
];

export function configuredSecretValues(
  env: Readonly<Record<string, string | undefined>>,
): readonly string[] {
  const values: string[] = [];
  for (const name of REDACTED_CREDENTIAL_NAMES) {
    const value = env[name];
    if (value !== undefined && value !== "") values.push(value);
  }
  return values;
}
