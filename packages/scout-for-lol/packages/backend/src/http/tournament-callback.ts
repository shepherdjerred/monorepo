import { z } from "zod";
import { createLogger } from "#src/logger.ts";
import { tournamentCallbacksTotal } from "#src/metrics/tournament.ts";

const logger = createLogger("tournament-callback");

/**
 * Only the field we log. The rest of Riot's payload is deliberately not
 * modelled: nothing reads it, and modelling it would imply otherwise.
 */
const CallbackShapeSchema = z.object({ shortCode: z.string() });

/**
 * Acknowledges a Riot tournament provider callback. Mutates nothing.
 *
 * Riot posts here when a tournament-code game finishes, and retries until it
 * gets a 200. Scout does not act on the body: the lobby poller and the
 * per-player match-history cursor already drive the whole lifecycle, and this
 * endpoint is unauthenticated — tournament-v5 offers no shared secret or
 * signature, so the URL is the only credential.
 *
 * The shortCode is logged so an operator can correlate a callback with a lobby
 * and see how its arrival time compares to `games/by-code` resolution. That
 * comparison is the evidence that would justify making this an accelerator.
 */
export async function handleTournamentCallback(
  request: Request,
): Promise<Response> {
  if (request.method !== "POST") {
    tournamentCallbacksTotal.inc({ status: "bad_method" });
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const body: unknown = await request.json();
    const parsed = CallbackShapeSchema.safeParse(body);
    logger.info(
      `🏟️ Tournament callback for ${parsed.success ? parsed.data.shortCode : "unknown"}`,
    );
    tournamentCallbacksTotal.inc({ status: "received" });
  } catch (error) {
    // A malformed body still gets a 200: Riot retries on anything else, and
    // there is nothing here to retry into. It is counted, not hidden.
    logger.warn("Tournament callback body was not JSON", error);
    tournamentCallbacksTotal.inc({ status: "unparseable" });
  }

  return new Response("ok", { status: 200 });
}
