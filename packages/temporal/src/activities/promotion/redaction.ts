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
  return url.href;
}

export function redactPromotionUrls(text: string): string {
  return text.replaceAll(/https?:\/\/[^\s"'<>\\]+/g, (address) =>
    promotionPublicUrl(address),
  );
}
