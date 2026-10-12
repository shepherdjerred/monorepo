import { stripVTControlCharacters } from "node:util";

const SECRET_NAME = String.raw`\w*(?:API[_-]?KEY|ACCESS[_-]?KEY|SECRET|PASSWORD|TOKEN|CREDENTIAL)\w*`;
const ASSIGNMENT = new RegExp(
  String.raw`\b(${SECRET_NAME})(\s*[=:]\s*)\S+`,
  "gi",
);
const JSON_SECRET = new RegExp(
  String.raw`("${SECRET_NAME}"\s*:\s*)"(?:[^"\\]|\\.)*"`,
  "gi",
);

/** Sanitize before truncating: a boundary must never expose part of a credential. */
export function sanitizeText(
  value: string,
  secrets: readonly string[] = [],
): string {
  let result = stripVTControlCharacters(value);
  const configured = Object.entries(Bun.env)
    .filter(
      ([name, secret]) =>
        /TOKEN|SECRET|PASSWORD|CREDENTIAL|API_KEY|ACCESS_KEY/i.test(name) &&
        (secret?.length ?? 0) >= 8,
    )
    .map(([, secret]) => secret);
  for (const secret of [...configured, ...secrets])
    if (secret !== undefined && secret !== "")
      result = result.split(secret).join("[REDACTED]");
  result = result
    .replaceAll(ASSIGNMENT, "$1$2[REDACTED]")
    .replaceAll(JSON_SECRET, '$1"[REDACTED]"')
    .replaceAll(/Bearer\s+[\w.\-+/=]+/g, "Bearer [REDACTED]")
    .replaceAll(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
      "[REDACTED]",
    );
  for (let code = 0; code < 32; code++) {
    if (![9, 10, 13].includes(code))
      result = result.replaceAll(String.fromCodePoint(code), "");
  }
  return result;
}
