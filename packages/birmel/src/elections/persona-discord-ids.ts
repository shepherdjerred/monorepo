import { getPerson } from "@shepherdjerred/glitter-context";

/**
 * Resolves a persona name (a Glitter style-card name / person id) to the Discord
 * user id used to fetch that user's avatar and bio when they win an election.
 *
 * The mapping is derived from the shared Glitter person data
 * (`@shepherdjerred/glitter-context`) rather than a hand-maintained table, so
 * every election candidate exposed by `listStyleCardNames()` stays aligned with
 * a profile id automatically — adding a new persona/style card no longer risks
 * an election completing without a profile update.
 */
export function getDiscordIdForPersona(persona: string): string | undefined {
  return getPerson(persona)?.discordUserIds[0];
}
