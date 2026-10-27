package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.core.home.DefaultHome;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.players.Humans;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.towns.app.Change;
import com.shepherdjerred.thestorm.towns.app.TownService;
import com.shepherdjerred.thestorm.towns.app.TownsState;
import com.shepherdjerred.thestorm.towns.domain.Explanations;
import com.shepherdjerred.thestorm.towns.domain.claiming.ClaimProblem;
import com.shepherdjerred.thestorm.towns.domain.land.ChunkPos;
import com.shepherdjerred.thestorm.towns.domain.land.Claim;
import com.shepherdjerred.thestorm.towns.domain.town.CampClock;
import com.shepherdjerred.thestorm.towns.domain.town.CampPolicy;
import com.shepherdjerred.thestorm.towns.domain.town.HouseStart;
import com.shepherdjerred.thestorm.towns.domain.town.Town;
import com.shepherdjerred.thestorm.towns.domain.town.TownProblem;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.bukkit.Material;
import org.bukkit.Tag;
import org.bukkit.block.Block;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerQuitEvent;

/**
 * Keeps camps alive, tells players when one lapses, and starts a camp when someone begins a house.
 * The detector is in memory. Deleting a camp lets it run again.
 */
final class CampLife implements Listener {

  private static final Duration SWEEP_EVERY = Duration.ofMinutes(10);
  private static final Duration REFRESH_EVERY = Duration.ofHours(1);

  private final ModuleContext context;
  private final TownService towns;
  private final TownsState state;
  private final CampPolicy policy;
  private final SealedWorlds sealed;
  private final Set<String> worlds;
  private final Map<UUID, Site> sites = new HashMap<>();
  private final Map<UUID, ChunkPos> refused = new HashMap<>();

  record Parts(
      ModuleContext context,
      TownService towns,
      TownsState state,
      CampPolicy policy,
      SealedWorlds sealed,
      Set<String> worlds) {}

  CampLife(Parts parts) {
    this.context = parts.context();
    this.towns = parts.towns();
    this.state = parts.state();
    this.policy = parts.policy();
    this.sealed = parts.sealed();
    this.worlds = Set.copyOf(parts.worlds());
  }

  void start() {
    context.scheduler().repeatOnMainThread(Duration.ofSeconds(20), SWEEP_EVERY, this::sweep);
  }

  /** Drops a half-built house signal, so a deleted camp can form again. */
  void forget(UUID player) {
    sites.remove(player);
    refused.remove(player);
  }

  void onJoin(Player player) {
    var holding = state.townOf(player.getUniqueId());
    if (holding.isPresent() && holding.get().isCamp()) {
      var camp = holding.get();
      if (CampClock.decide(camp, context.time().instant(), false, policy)
          == CampClock.Action.WARN) {
        player.sendMessage(
            Notices.info(
                "Your camp was close to being released. Logging in refreshed it. It stays while a"
                    + " member is seen within "
                    + policy.idleDays()
                    + " days. /camp help explains the clock."));
      }
      towns.touchCamp(player.getUniqueId());
    }
    deliverNotice(player);
  }

  private void deliverNotice(Player player) {
    var _ =
        towns
            .settling()
            .store()
            .notice(player.getUniqueId())
            .whenCompleteAsync(
                (message, failure) -> {
                  if (failure != null
                      || message == null
                      || message.isEmpty()
                      || !player.isOnline()) {
                    return;
                  }
                  player.sendMessage(Notices.info(message.orElseThrow()));
                  var _ = towns.settling().store().clearNotice(player.getUniqueId());
                },
                context.scheduler().mainThread());
  }

  private void sweep() {
    var now = context.time().instant();
    for (var town : List.copyOf(state.towns())) {
      if (!town.isCamp()) {
        continue;
      }
      var online =
          town.members().keySet().stream()
              .map(context.plugin().getServer()::getPlayer)
              .filter(player -> player != null)
              .toList();
      var idle = CampClock.decide(town, now, false, policy);
      if (!online.isEmpty()) {
        if (idle == CampClock.Action.WARN) {
          online.forEach(
              player ->
                  player.sendMessage(
                      Notices.info(
                          "Your camp will be released in "
                              + policy.warnDays()
                              + " days of nobody being online. Being here refreshed it.")));
        }
        var last = town.lastActive().orElseGet(town::createdAt);
        if (idle == CampClock.Action.WARN || last.isBefore(now.minus(REFRESH_EVERY))) {
          towns.touchCamp(online.getFirst().getUniqueId());
        }
      } else if (idle == CampClock.Action.LAPSE) {
        lapse(town);
      }
    }
  }

  private void lapse(Town town) {
    var message =
        "Your camp was released after "
            + policy.idleDays()
            + " days with nobody online. Its land is wilderness again. Locked containers stay"
            + " locked.";
    var notices = new HashMap<UUID, String>();
    town.members()
        .keySet()
        .forEach(
            member -> {
              var online = context.plugin().getServer().getPlayer(member);
              if (online != null) {
                online.sendMessage(Notices.info(message));
              } else {
                notices.put(member, message);
              }
            });
    var result = towns.disbandCamp(town.owner(), "delete", Map.copyOf(notices));
    if (result instanceof Result.Err<?, ?>) {
      context.logger().error("A lapsed camp could not be removed: {}", town.id());
    }
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onPlace(BlockPlaceEvent event) {
    var player = event.getPlayer();
    if (!Humans.isHuman(player) || state.townOf(player.getUniqueId()).isPresent()) {
      return;
    }
    var block = event.getBlockPlaced();
    if (sealed.isSealed(block.getWorld()) || !worlds.contains(block.getWorld().getName())) {
      return;
    }
    var chunk = chunkOf(block);
    if (chunk.equals(refused.get(player.getUniqueId()))) {
      return;
    }
    var now = context.time().instant();
    var site = sites.computeIfAbsent(player.getUniqueId(), id -> new Site(chunk, now));
    if (!site.chunk.equals(chunk) && !site.chunk.isEdgeAdjacentTo(chunk)) {
      site = new Site(chunk, now);
      sites.put(player.getUniqueId(), site);
    }
    if (!site.chunk.equals(chunk) || site.settling) {
      return;
    }
    note(site, block.getType());
    var ready =
        HouseStart.ready(
            site.chunk,
            new HouseStart.Placements(
                site.bed, site.door, site.chest, site.blocks, Optional.of(site.since)),
            now,
            policy);
    if (ready.isPresent()) {
      var where = player.getLocation();
      if (where == null) {
        return;
      }
      site.settling = true;
      settle(player, ready.orElseThrow(), where);
    }
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onMove(PlayerMoveEvent event) {
    var to = event.getTo();
    if (to == null || !Humans.isHuman(event.getPlayer())) {
      return;
    }
    var from = event.getFrom();
    var fromWorld = from.getWorld();
    var toWorld = to.getWorld();
    if (fromWorld != null
        && fromWorld.equals(toWorld)
        && from.getChunk().getX() == to.getChunk().getX()
        && from.getChunk().getZ() == to.getChunk().getZ()) {
      return;
    }
    var site = sites.get(event.getPlayer().getUniqueId());
    if (site == null || site.settling) {
      return;
    }
    if (toWorld == null) {
      sites.remove(event.getPlayer().getUniqueId());
      return;
    }
    var chunk = ChunkPos.ofBlock(toWorld.getName(), to.getBlockX(), to.getBlockZ());
    if (!site.chunk.equals(chunk) && !site.chunk.isEdgeAdjacentTo(chunk)) {
      sites.remove(event.getPlayer().getUniqueId());
    }
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void onQuit(PlayerQuitEvent event) {
    forget(event.getPlayer().getUniqueId());
  }

  private void settle(Player player, ChunkPos chunk, org.bukkit.Location where) {
    var founded = towns.foundCamp(player.getUniqueId());
    switch (founded) {
      case Result.Err<Change<Town>, List<TownProblem>>(var problems) -> {
        sites.remove(player.getUniqueId());
        if (!(problems.getFirst() instanceof TownProblem.Busy)) {
          refused.put(player.getUniqueId(), chunk);
          player.sendMessage(Notices.error(Explanations.explain(problems.getFirst())));
        }
      }
      case Result.Ok<Change<Town>, List<TownProblem>>(var change) -> {
        var _ =
            change
                .saved()
                .whenComplete(
                    (ok, failure) -> {
                      if (failure != null) {
                        sites.remove(player.getUniqueId());
                        return;
                      }
                      claim(player, chunk, where);
                    });
      }
    }
  }

  private void claim(Player player, ChunkPos chunk, org.bukkit.Location where) {
    var claimed = towns.claim(player.getUniqueId(), chunk);
    switch (claimed) {
      case Result.Err<Change<Claim>, List<ClaimProblem>>(var problems) ->
          undo(player, chunk, problems);
      case Result.Ok<Change<Claim>, List<ClaimProblem>>(var change) -> {
        var _ =
            change
                .saved()
                .whenComplete(
                    (ok, failure) -> {
                      sites.remove(player.getUniqueId());
                      if (failure != null || !player.isOnline()) {
                        return;
                      }
                      tell(player, where);
                    });
      }
    }
  }

  private void undo(Player player, ChunkPos chunk, List<ClaimProblem> problems) {
    var removed = towns.disbandCamp(player.getUniqueId(), "delete", Map.of());
    if (removed instanceof Result.Ok<Change<Town>, List<TownProblem>>(var change)) {
      var _ =
          change
              .saved()
              .whenComplete(
                  (ok, failure) -> {
                    sites.remove(player.getUniqueId());
                    refused.put(player.getUniqueId(), chunk);
                    if (!player.isOnline()) {
                      return;
                    }
                    var why =
                        problems.isEmpty()
                            ? "that chunk cannot be claimed"
                            : Explanations.explain(problems.getFirst(), id -> "your camp");
                    player.sendMessage(
                        Notices.error(
                            "A camp was not kept here: "
                                + why
                                + ". Move to another chunk and the next shelter can start one."
                                + " /camp help explains claiming."));
                  });
    }
  }

  private void tell(Player player, org.bukkit.Location where) {
    var home = context.services().find(DefaultHome.class);
    if (home.isEmpty()) {
      player.sendMessage(Notices.success(settled(false, false)));
      return;
    }
    var _ =
        home.get()
            .setIfAbsent(player.getUniqueId(), where)
            .whenCompleteAsync(
                (created, failure) -> {
                  if (!player.isOnline()) {
                    return;
                  }
                  player.sendMessage(
                      Notices.success(settled(failure == null, Boolean.TRUE.equals(created))));
                },
                context.scheduler().mainThread());
  }

  private static String settled(boolean asked, boolean created) {
    var home =
        !asked
            ? " Set a home with /sethome."
            : created ? " This is your default home." : " Your existing home was left as it is.";
    return "A camp was created and this chunk was claimed."
        + home
        + " Undo with /unclaim, /delhome, and /camp delete delete. Read /camp help.";
  }

  private static void note(Site site, Material material) {
    if (Tag.BEDS.isTagged(material)) {
      site.bed = true;
    } else if (Tag.DOORS.isTagged(material)) {
      site.door = true;
    } else if (material == Material.CHEST
        || material == Material.TRAPPED_CHEST
        || material == Material.BARREL) {
      site.chest = true;
    }
    if (material.isSolid()) {
      site.blocks++;
    }
  }

  private static ChunkPos chunkOf(Block block) {
    return ChunkPos.ofBlock(block.getWorld().getName(), block.getX(), block.getZ());
  }

  private static final class Site {
    private final ChunkPos chunk;
    private final Instant since;
    private int blocks;
    private boolean door;
    private boolean chest;
    private boolean bed;
    private boolean settling;

    private Site(ChunkPos chunk, Instant since) {
      this.chunk = chunk;
      this.since = since;
    }
  }
}
