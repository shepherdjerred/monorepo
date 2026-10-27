package com.shepherdjerred.thestorm.advancements.adapter.paper;

import com.shepherdjerred.thestorm.advancements.domain.Grants;
import com.shepherdjerred.thestorm.arena.app.ArenaCatalog;
import com.shepherdjerred.thestorm.arena.app.ArenaNotification;
import com.shepherdjerred.thestorm.arena.app.ArenaRecords;
import com.shepherdjerred.thestorm.core.players.Humans;
import com.shepherdjerred.thestorm.essentials.app.store.HomeStore;
import com.shepherdjerred.thestorm.quests.app.QuestCompletions;
import com.shepherdjerred.thestorm.rwf.app.RwfCareers;
import com.shepherdjerred.thestorm.rwf.app.store.MatchStats;
import com.shepherdjerred.thestorm.rwf.app.store.StatsStore;
import com.shepherdjerred.thestorm.shards.app.StormShards;
import com.shepherdjerred.thestorm.skills.app.SkillLevelUp;
import com.shepherdjerred.thestorm.skills.app.SkillLevels;
import com.shepherdjerred.thestorm.towns.app.TownMilestones;
import com.shepherdjerred.thestorm.towns.app.TownRead;
import com.shepherdjerred.thestorm.tracks.app.Track;
import com.shepherdjerred.thestorm.tracks.app.TrackLevels;
import java.util.List;
import java.util.OptionalInt;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.bukkit.Server;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.Plugin;

/**
 * Listens to the other modules and awards the milestones they already saved. Reads that finish off
 * the main thread are completed back on it. Catch-up on join fills in what the player already
 * reached without a chat or Discord announcement. Locks, spells, and arena clears have no stored
 * history, so they are awarded only as they happen.
 */
public final class AdvancementFeeds implements Listener {

  private final Plugin plugin;
  private final Server server;
  private final Executor main;
  private final ComponentLogger logger;
  private final AdvancementAwarder awarder;
  private final QuestCompletions quests;
  private final TownRead towns;
  private final StormShards shards;
  private final TrackLevels trackLevels;
  private final SkillLevels skillLevels;
  private final ArenaRecords arenaRecords;
  private final ArenaCatalog arenas;
  private final StatsStore stats;
  private final HomeStore homes;

  public AdvancementFeeds(Plugin plugin, Server server, Executor main, FeedSources sources) {
    this.plugin = plugin;
    this.server = server;
    this.main = main;
    this.logger = sources.logger();
    this.awarder = sources.awarder();
    this.quests = sources.quests();
    this.towns = sources.towns();
    this.shards = sources.shards();
    this.trackLevels = sources.trackLevels();
    this.skillLevels = sources.skillLevels();
    this.arenaRecords = sources.arenaRecords();
    this.arenas = sources.arenas();
    this.stats = sources.stats();
    this.homes = sources.homes();
    sources
        .quests()
        .subscribe(standing -> award(standing.player(), Grants.quests(standing.counted())));
    sources.townMilestones().subscribe(this::town);
    sources
        .shardUpgrades()
        .subscribe(upgrade -> award(upgrade.player(), Grants.shard(upgrade.tier())));
    sources
        .trackSignals()
        .subscribePurchases(
            grant -> award(grant.player(), Grants.track(grant.track().id(), grant.level())));
    sources.trackSignals().subscribeLoaded(this::tracksLoaded);
    sources.skillSignals().subscribe(this::skill);
    sources.arenaEvents().subscribe(this::arena);
    sources
        .spells()
        .subscribe(
            cast -> {
              award(cast.player(), Grants.firstSpell());
              award(cast.player(), Grants.spell(cast.spell()));
            });
    sources.careers().subscribe(this::career);
    sources.homeSignals().subscribe(player -> award(player, Grants.home()));
    sources.locks().subscribe(player -> award(player, Grants.lock()));
  }

  public void start() {
    server.getPluginManager().registerEvents(this, plugin);
    for (var player : server.getOnlinePlayers()) {
      if (Humans.isHuman(player)) {
        backfill(player);
      }
    }
  }

  @EventHandler
  void onJoin(PlayerJoinEvent event) {
    if (Humans.isHuman(event.getPlayer())) {
      backfill(event.getPlayer());
    }
  }

  private void backfill(Player player) {
    quests
        .counted(player.getUniqueId())
        .ifPresent(count -> awarder.catchUp(player, Grants.quests(count)));
    var claims = towns.claims(player.getUniqueId());
    if (claims.isPresent()) {
      awarder.catchUp(player, Grants.town(true, claims.getAsInt()));
    }
    var tier = carriedTier(player);
    if (tier > 0) {
      awarder.catchUp(player, Grants.shard(tier));
    }
    if (trackLevels.isLoaded(player.getUniqueId())) {
      grantTracks(player);
    }
    readSkills(player);
    readWaves(player);
    readCareer(player);
    readHomes(player);
  }

  private void readSkills(Player player) {
    var _ =
        skillLevels
            .progress(player.getUniqueId())
            .whenCompleteAsync(
                (progress, failure) -> {
                  if (failure != null) {
                    logger.error("Could not read skills for {}", player.getUniqueId(), failure);
                    return;
                  }
                  if (!player.isOnline()) {
                    return;
                  }
                  for (var skill : progress.levels().entrySet()) {
                    awarder.catchUp(player, Grants.skill(skill.getKey(), skill.getValue()));
                  }
                },
                main);
  }

  private void readWaves(Player player) {
    var _ =
        bestWave(player.getUniqueId())
            .whenCompleteAsync(
                (wave, failure) -> {
                  if (failure != null) {
                    logger.error(
                        "Could not read arena waves for {}", player.getUniqueId(), failure);
                    return;
                  }
                  if (player.isOnline()) {
                    awarder.catchUp(player, Grants.waves(wave));
                  }
                },
                main);
  }

  private void readCareer(Player player) {
    var _ =
        stats
            .totals(player.getUniqueId())
            .whenCompleteAsync(
                (totals, failure) -> {
                  if (failure != null) {
                    logger.error(
                        "Could not read Search and Destroy stats for {}",
                        player.getUniqueId(),
                        failure);
                    return;
                  }
                  if (totals.isEmpty() || !player.isOnline()) {
                    return;
                  }
                  var row = totals.get();
                  awarder.catchUp(player, Grants.search(searchTotals(row, row.wins())));
                },
                main);
  }

  private void readHomes(Player player) {
    var _ =
        homes
            .homes(player.getUniqueId())
            .whenCompleteAsync(
                (saved, failure) -> {
                  if (failure != null) {
                    logger.error("Could not read homes for {}", player.getUniqueId(), failure);
                    return;
                  }
                  if (!saved.isEmpty() && player.isOnline()) {
                    awarder.catchUp(player, Grants.home());
                  }
                },
                main);
  }

  private void town(TownMilestones.Milestone milestone) {
    switch (milestone) {
      case TownMilestones.Milestone.Founded(var ignored, var founder) ->
          award(founder, Grants.town(true, claimsOf(founder)));
      case TownMilestones.Milestone.Joined(var ignored, var player) ->
          award(player, Grants.town(true, claimsOf(player)));
      case TownMilestones.Milestone.Grew(var townId, var ignored, var claims) -> {
        for (var member : towns.members(townId)) {
          award(member, Grants.town(true, claims));
        }
      }
    }
  }

  private int claimsOf(UUID player) {
    var claims = towns.claims(player);
    if (claims.isEmpty()) {
      throw new IllegalStateException(player + " has no town after joining one");
    }
    return claims.getAsInt();
  }

  private void tracksLoaded(UUID player) {
    var online = server.getPlayer(player);
    if (online != null && Humans.isHuman(online)) {
      grantTracks(online);
    }
  }

  private void grantTracks(Player player) {
    for (var track : Track.values()) {
      var level = trackLevels.level(player, track);
      if (level > 0) {
        awarder.catchUp(player, Grants.track(track.id(), level));
      }
    }
  }

  private void skill(SkillLevelUp levelUp) {
    award(levelUp.player(), Grants.skillCrossed(levelUp.skillId(), levelUp.from(), levelUp.to()));
  }

  private void arena(ArenaNotification note) {
    for (var milestone : note.milestones()) {
      var earned = Grants.arenaNotice(milestone.kind(), milestone.wave());
      for (var fighter : milestone.fighters()) {
        award(fighter, earned);
      }
    }
  }

  private void career(RwfCareers.Settled settled) {
    for (var line : settled.players()) {
      var online = server.getPlayer(line.player());
      if (online == null || !Humans.isHuman(online)) {
        continue;
      }
      var won = line.result() == MatchStats.Result.WIN;
      var afk = line.afk();
      var _ =
          stats
              .totals(line.player())
              .whenCompleteAsync(
                  (totals, failure) -> {
                    if (failure != null) {
                      logger.error(
                          "Could not read Search and Destroy stats for {}", line.player(), failure);
                      return;
                    }
                    if (totals.isEmpty() || !online.isOnline()) {
                      return;
                    }
                    var row = totals.get();
                    awarder.grant(
                        online,
                        Grants.search(
                            searchTotals(row, Grants.winsCountingThisMatch(row.wins(), won, afk))));
                  },
                  main);
    }
  }

  private CompletableFuture<Integer> bestWave(UUID player) {
    CompletableFuture<Integer> best = CompletableFuture.completedFuture(0);
    for (var arena : arenas.ids()) {
      best = best.thenCombine(arenaRecords.bestWave(player, arena), AdvancementFeeds::further);
    }
    return best;
  }

  private static int further(int soFar, OptionalInt wave) {
    return wave.isPresent() ? Math.max(soFar, wave.getAsInt()) : soFar;
  }

  private int carriedTier(Player player) {
    var tier = 0;
    var inventory = player.getInventory();
    tier = maxTier(tier, inventory.getStorageContents());
    tier = maxTier(tier, inventory.getArmorContents());
    tier = maxTier(tier, new ItemStack[] {inventory.getItemInOffHand()});
    return maxTier(tier, player.getEnderChest().getContents());
  }

  private int maxTier(int tier, ItemStack[] items) {
    for (var item : items) {
      if (item == null) {
        continue;
      }
      var found = shards.stormTier(item);
      if (found.isPresent()) {
        tier = Math.max(tier, found.getAsInt());
      }
    }
    return tier;
  }

  private static Grants.SearchTotals searchTotals(StatsStore.Totals row, int wins) {
    return new Grants.SearchTotals(
        row.matches(), wins, row.kills(), row.assists(), row.bestWinStreak(), row.bestStreak());
  }

  private void award(UUID player, List<String> paths) {
    if (paths.isEmpty()) {
      return;
    }
    var online = server.getPlayer(player);
    if (online != null) {
      awarder.grant(online, paths);
    }
  }
}
