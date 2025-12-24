import { getGuildOwner } from "../database/repositories/guild-owner.js";
import { getConfig } from "../config/index.js";

export async function getGuildPersona(guildId: string): Promise<string> {
	const owner = await getGuildOwner(guildId);
	return owner?.currentOwner ?? getConfig().persona.defaultPersona;
}
