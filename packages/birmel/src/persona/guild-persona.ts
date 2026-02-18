import { getGuildOwner } from "@shepherdjerred/birmel/database/repositories/guild-owner.js";
import { getConfig } from "@shepherdjerred/birmel/config/index.js";

export async function getGuildPersona(guildId: string): Promise<string> {
  const owner = await getGuildOwner(guildId);
  return owner?.currentOwner ?? getConfig().persona.defaultPersona;
}
