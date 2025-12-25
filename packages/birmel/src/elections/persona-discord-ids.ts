/**
 * Mapping of persona names to Discord user IDs.
 * Used to fetch the Discord user's avatar and bio when they win an election.
 */
export const PERSONA_DISCORD_IDS: Record<string, string> = {
	aaron: "TODO_AARON_DISCORD_ID",
	brian: "TODO_BRIAN_DISCORD_ID",
	danny: "TODO_DANNY_DISCORD_ID",
	edward: "TODO_EDWARD_DISCORD_ID",
	hirza: "TODO_HIRZA_DISCORD_ID",
	irfan: "TODO_IRFAN_DISCORD_ID",
	jerred: "TODO_JERRED_DISCORD_ID",
	long: "TODO_LONG_DISCORD_ID",
	ryan: "TODO_RYAN_DISCORD_ID",
	virmel: "TODO_VIRMEL_DISCORD_ID",
};

export function getDiscordIdForPersona(persona: string): string | undefined {
	return PERSONA_DISCORD_IDS[persona.toLowerCase()];
}
