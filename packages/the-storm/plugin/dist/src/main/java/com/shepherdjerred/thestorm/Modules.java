package com.shepherdjerred.thestorm;

import com.shepherdjerred.thestorm.arena.ArenaModule;
import com.shepherdjerred.thestorm.chat.ChatModule;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.discord.DiscordModule;
import com.shepherdjerred.thestorm.economy.EconomyModule;
import com.shepherdjerred.thestorm.essentials.EssentialsModule;
import com.shepherdjerred.thestorm.mechanics.MechanicsModule;
import com.shepherdjerred.thestorm.messages.MessagesModule;
import com.shepherdjerred.thestorm.mobs.MobsModule;
import com.shepherdjerred.thestorm.npcs.NpcsModule;
import com.shepherdjerred.thestorm.qol.QolModule;
import com.shepherdjerred.thestorm.quests.QuestsModule;
import com.shepherdjerred.thestorm.seasonal.SeasonalModule;
import com.shepherdjerred.thestorm.shards.ShardsModule;
import com.shepherdjerred.thestorm.shops.ShopsModule;
import com.shepherdjerred.thestorm.skills.SkillsModule;
import com.shepherdjerred.thestorm.spells.SpellsModule;
import com.shepherdjerred.thestorm.towns.TownsModule;
import com.shepherdjerred.thestorm.tracks.TracksModule;
import com.shepherdjerred.thestorm.world.WorldModule;
import java.util.List;

/** Every module, in enable order. Foundational modules come before the modules that use them. */
final class Modules {

  private Modules() {}

  static List<StormModule> all() {
    return List.of(
        new EconomyModule(),
        new MessagesModule(),
        new ChatModule(),
        new DiscordModule(),
        new EssentialsModule(),
        new ShopsModule(),
        new ShardsModule(),
        new TownsModule(),
        new TracksModule(),
        new MechanicsModule(),
        new SpellsModule(),
        new NpcsModule(),
        new QuestsModule(),
        new ArenaModule(),
        new MobsModule(),
        new QolModule(),
        new SkillsModule(),
        new SeasonalModule(),
        new WorldModule());
  }
}
