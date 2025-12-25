/**
 * Mapping of persona names to Discord user IDs.
 * Used to fetch the Discord user's avatar and bio when they win an election.
 */
export const PERSONA_DISCORD_IDS: Record<string, string> = {
	aaron: "186665676134547461",
	brian: "202595851678384137",
	danny: "263577791105073152",
	edward: "208404668026454016",
	hirza: "528096854831792159",
	irfan: "410595870380392458",
	jerred: "160509172704739328",
	long: "251485022429642752",
	ryan: "200067001035653131",
	virmel: "208425244128444418",
};

export function getDiscordIdForPersona(persona: string): string | undefined {
	return PERSONA_DISCORD_IDS[persona.toLowerCase()];
}
