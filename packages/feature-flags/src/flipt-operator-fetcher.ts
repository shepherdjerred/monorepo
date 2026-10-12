import type { FliptFetcher } from "./managed-flag-drift.ts";

/** Management credentials are scoped to the selected Flipt origin. */
export function createFliptOperatorFetcher(
  url: string,
  token: string | undefined,
  upstream: FliptFetcher = fetch,
): FliptFetcher {
  if (token === undefined || token.trim() === "")
    throw new Error(
      "FLIPT_OPERATOR_TOKEN is required for --apply-missing; inject it through 1Password",
    );
  const origin = new URL(url).origin;
  return (input, init) => {
    const target = input instanceof Request ? input.url : input;
    if (new URL(target).origin !== origin)
      throw new Error("Flipt operator request changed origin");
    const headers = new Headers(
      input instanceof Request ? input.headers : undefined,
    );
    new Headers(init?.headers).forEach((value, key) => {
      headers.set(key, value);
    });
    headers.set("Authorization", `Bearer ${token}`);
    return upstream(input, { ...init, headers, redirect: "error" });
  };
}
