import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import type { SportsPageRenderer } from "@shepherdjerred/streambot/sports/pinchtab.ts";
import type { SportsResolver } from "@shepherdjerred/streambot/sports/types.ts";
import type { PrepareSportsInput } from "@shepherdjerred/streambot/sports/prepared-input.ts";
import { BrowserSportsResolver } from "@shepherdjerred/streambot/sports/sports-resolver.ts";
import { validatePreparedSportsInput } from "@shepherdjerred/streambot/sources/sports-preparation.ts";

/** Production and live acceptance share the same candidate validation boundary. */
export function createSportsResolver(
  browser: SportsPageRenderer,
  config: Config,
): SportsResolver & { readonly prepare: PrepareSportsInput } {
  const resolver = new BrowserSportsResolver(browser, (input, signal) =>
    validatePreparedSportsInput(config, input, signal),
  );
  const prepare = resolver.prepare;
  if (prepare === undefined)
    throw new Error("Validated sports resolver has no preparation port");
  return { resolve: resolver.resolve.bind(resolver), prepare };
}
