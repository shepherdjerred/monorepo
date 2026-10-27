import { agentTaskSecretTokens } from "#activities/agent/agent-task-env.ts";

/** Public account names and map keys must remain usable in scoped browser URLs. */
export function promotionSecretTokens(
  logins: Readonly<
    Record<
      string,
      {
        username: string;
        email?: string | undefined;
        password: string;
        otp?: string | undefined;
      }
    >
  >,
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
): readonly (string | undefined)[] {
  const source = { ...environment };
  delete source["STORM_PROMOTION_LOGINS"];
  return [
    ...agentTaskSecretTokens(undefined, source),
    environment["STORM_PROMOTION_LOGINS"],
    ...Object.values(logins).flatMap((login) => [
      login.password,
      login.otp,
      ...(login.otp !== undefined && URL.canParse(login.otp)
        ? [new URL(login.otp).searchParams.get("secret") ?? undefined]
        : []),
      JSON.stringify(login.password).slice(1, -1),
      ...(login.username.includes("@") ? [login.username] : []),
      ...(login.email === undefined ? [] : [login.email]),
    ]),
  ];
}

/** Strip navigation nonces before observations enter prompts or evidence storage. */
export function promotionPublicUrl(address: string): string {
  const url = new URL(address);
  const sensitive = new Set<string>();
  for (const key of url.searchParams.keys()) {
    if (
      /token|csrf|nonce|auth|password|secret|session|signature|^(?:key|sid|sig)$/i.test(
        key,
      )
    )
      sensitive.add(key);
  }
  for (const key of sensitive) url.searchParams.delete(key);
  if (/token|csrf|nonce|auth|password|secret|session|signature/i.test(url.hash))
    url.hash = "";
  return url.href;
}

export function redactPromotionUrls(text: string): string {
  return text.replaceAll(/https?:\/\/[^\s"'<>\\]+/g, (address) => {
    try {
      return promotionPublicUrl(address);
    } catch {
      return "[unparseable-url]";
    }
  });
}
