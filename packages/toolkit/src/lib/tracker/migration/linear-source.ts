import { resolveCredentials } from "#lib/credentials.ts";
export type LinearQuery = (
  document: string,
  variables: Record<string, unknown>,
) => Promise<unknown>;

/** Fixed export queries only. There is deliberately no Linear mutation path. */
export const queryLinearHistory: LinearQuery = async (document, variables) => {
  if (!/^query(?:\s|\{)/u.test(document))
    throw new Error("History migration accepts queries only");
  await resolveCredentials(["LINEAR_MIGRATION_API_KEY"]);
  const token = Bun.env["LINEAR_MIGRATION_API_KEY"];
  if (token === undefined || token === "")
    throw new Error("Missing Linear migration credential");
  for (let attempt = 0; ; attempt++) {
    const response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: token.startsWith("lin_api_") ? token : "Bearer " + token,
      },
      body: JSON.stringify({ query: document, variables }),
      signal: AbortSignal.timeout(60_000),
    });
    if (response.status === 429 && attempt < 5) {
      await response.body?.cancel();
      await Bun.sleep(Math.min(60_000, 2 ** attempt * 2000));
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        "Linear history query returned HTTP " + String(response.status),
      );
    }
    const result: unknown = await response.json();
    if (
      typeof result !== "object" ||
      result === null ||
      ("errors" in result &&
        Array.isArray(result.errors) &&
        result.errors.length > 0)
    )
      throw new Error("Linear rejected the history query");
    return result;
  }
};
