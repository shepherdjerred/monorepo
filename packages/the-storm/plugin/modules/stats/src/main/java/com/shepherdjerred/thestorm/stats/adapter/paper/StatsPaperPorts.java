package com.shepherdjerred.thestorm.stats.adapter.paper;

import com.shepherdjerred.thestorm.arena.app.ArenaCatalog;
import com.shepherdjerred.thestorm.arena.app.ArenaPresence;
import com.shepherdjerred.thestorm.arena.app.ArenaRecords;
import com.shepherdjerred.thestorm.core.module.Services;
import com.shepherdjerred.thestorm.core.players.Nicknames;
import com.shepherdjerred.thestorm.core.towns.TownDirectory;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.essentials.app.AfkStatus;
import com.shepherdjerred.thestorm.quests.app.QuestCompletions;
import com.shepherdjerred.thestorm.rwf.app.store.StatsStore;
import com.shepherdjerred.thestorm.skills.app.SkillLevels;
import com.shepherdjerred.thestorm.towns.app.TownMembership;
import com.shepherdjerred.thestorm.towns.app.TownRead;
import com.shepherdjerred.thestorm.tracks.app.TrackLevels;
import java.util.Optional;

/** Optional sibling module ports discovered from {@link Services} without hard coupling. */
public record StatsPaperPorts(
    Optional<AfkStatus> afkStatus,
    Optional<ArenaPresence> arenaPresence,
    Optional<ArenaCatalog> arenaCatalog,
    Optional<ArenaRecords> arenaRecords,
    Optional<Wallets> wallets,
    Optional<TownRead> townRead,
    Optional<TownMembership> townMembership,
    Optional<TownDirectory> townDirectory,
    Optional<SkillLevels> skillLevels,
    Optional<TrackLevels> trackLevels,
    Optional<QuestCompletions> questCompletions,
    Optional<StatsStore> rwfStats,
    Optional<Nicknames> nicknames) {

  public static StatsPaperPorts discover(Services services) {
    return new StatsPaperPorts(
        services.find(AfkStatus.class),
        services.find(ArenaPresence.class),
        services.find(ArenaCatalog.class),
        services.find(ArenaRecords.class),
        services.find(Wallets.class),
        services.find(TownRead.class),
        services.find(TownMembership.class),
        services.find(TownDirectory.class),
        services.find(SkillLevels.class),
        services.find(TrackLevels.class),
        services.find(QuestCompletions.class),
        services.find(StatsStore.class),
        services.find(Nicknames.class));
  }
}
