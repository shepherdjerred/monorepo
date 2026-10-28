package com.shepherdjerred.thestorm.advancements.adapter.paper;

import com.shepherdjerred.thestorm.arena.app.ArenaCatalog;
import com.shepherdjerred.thestorm.arena.app.ArenaEvents;
import com.shepherdjerred.thestorm.arena.app.ArenaRecords;
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
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;

/** The modules an advancement feed listens to and reads back from. */
public record FeedSources(
    ComponentLogger logger,
    AdvancementAwarder awarder,
    QuestCompletions quests,
    TownMilestones townMilestones,
    TownRead towns,
    ShardUpgrades shardUpgrades,
    StormShards shards,
    TrackSignals trackSignals,
    TrackLevels trackLevels,
    SkillSignals skillSignals,
    SkillLevels skillLevels,
    ArenaEvents arenaEvents,
    ArenaRecords arenaRecords,
    ArenaCatalog arenas,
    SpellCasts spells,
    RwfCareers careers,
    StatsStore stats,
    HomeSignals homeSignals,
    HomeStore homes,
    LockSaves locks) {}
