package com.shepherdjerred.thestorm.advancements;

import com.shepherdjerred.thestorm.advancements.adapter.paper.AdvancementAwarder;
import com.shepherdjerred.thestorm.advancements.adapter.paper.AdvancementFeeds;
import com.shepherdjerred.thestorm.advancements.adapter.paper.FeedSources;
import com.shepherdjerred.thestorm.arena.app.ArenaCatalog;
import com.shepherdjerred.thestorm.arena.app.ArenaEvents;
import com.shepherdjerred.thestorm.arena.app.ArenaRecords;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.core.reset.PlayerResetRegistry;
import com.shepherdjerred.thestorm.essentials.app.HomeSignals;
import com.shepherdjerred.thestorm.essentials.app.store.HomeStore;
import com.shepherdjerred.thestorm.quests.app.QuestCompletions;
import com.shepherdjerred.thestorm.rwf.app.RwfCareers;
import com.shepherdjerred.thestorm.rwf.app.store.StatsStore;
import com.shepherdjerred.thestorm.shards.app.ShardUpgrades;
import com.shepherdjerred.thestorm.shards.app.StormShards;
import com.shepherdjerred.thestorm.skills.app.SkillLevels;
import com.shepherdjerred.thestorm.skills.app.SkillSignals;
import com.shepherdjerred.thestorm.spells.app.SpellCasts;
import com.shepherdjerred.thestorm.towns.app.LockSaves;
import com.shepherdjerred.thestorm.towns.app.TownMilestones;
import com.shepherdjerred.thestorm.towns.app.TownRead;
import com.shepherdjerred.thestorm.tracks.app.TrackLevels;
import com.shepherdjerred.thestorm.tracks.app.TrackSignals;

/**
 * Server milestones as advancements. A new one toasts and is announced in chat and on Discord.
 * Milestones already reached are filled in without that announcement. {@code /quests} remains the
 * journal.
 */
public final class AdvancementsModule implements StormModule {

  @Override
  public String id() {
    return "advancements";
  }

  @Override
  public void enable(ModuleContext context) {
    context.services().require(PlayerResetRegistry.class).stateless(id());
    var server = context.plugin().getServer();
    var awarder = new AdvancementAwarder(server);
    awarder.requireInstalled();
    server.getPluginManager().registerEvents(awarder, context.plugin());
    var services = context.services();
    new AdvancementFeeds(
            context.plugin(),
            server,
            context.scheduler().mainThread(),
            new FeedSources(
                context.logger(),
                awarder,
                services.require(QuestCompletions.class),
                services.require(TownMilestones.class),
                services.require(TownRead.class),
                services.require(ShardUpgrades.class),
                services.require(StormShards.class),
                services.require(TrackSignals.class),
                services.require(TrackLevels.class),
                services.require(SkillSignals.class),
                services.require(SkillLevels.class),
                services.require(ArenaEvents.class),
                services.require(ArenaRecords.class),
                services.require(ArenaCatalog.class),
                services.require(SpellCasts.class),
                services.require(RwfCareers.class),
                services.require(StatsStore.class),
                services.require(HomeSignals.class),
                services.require(HomeStore.class),
                services.require(LockSaves.class)))
        .start();
  }
}
