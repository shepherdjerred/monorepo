package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.protection.SettledLand;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.qol.app.LandingMemory;
import com.shepherdjerred.thestorm.qol.app.QolStore;
import com.shepherdjerred.thestorm.qol.domain.QolConfig;
import com.shepherdjerred.thestorm.qol.domain.rtp.BlockPoint;
import com.shepherdjerred.thestorm.qol.domain.rtp.RtpDecision;
import com.shepherdjerred.thestorm.qol.domain.rtp.RtpPricing;
import com.shepherdjerred.thestorm.world.app.WildWorlds;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.entity.Player;

/** Random teleport: search, stand still, then charge and move. */
final class RtpFlow {

  private final Set<UUID> busy = new HashSet<>();
  private final WildWorlds worlds;
  private final SettledLand land;
  private final QolStore store;
  private final Wallets wallets;
  private final LandingMemory memory;
  private final ModuleContext context;
  private final QolConfig config;
  private final RtpSearch search;
  private final Warmups warmups;
  private final RtpPricing pricing;

  RtpFlow(Ports ports, ModuleContext context, QolConfig config, LandingMemory memory) {
    this.worlds = ports.worlds();
    this.land = ports.land();
    this.store = ports.store();
    this.wallets = ports.wallets();
    this.memory = memory;
    this.context = context;
    this.config = config;
    this.search = new RtpSearch(config, context.scheduler());
    this.warmups = new Warmups(context.scheduler());
    this.pricing =
        new RtpPricing(config.freeForDuration(), config.cooldownDuration(), config.cost());
  }

  Warmups warmups() {
    return warmups;
  }

  /** Starts a teleport into {@code worldName}, optionally in {@code biome}. */
  void start(Player player, String worldName, Optional<String> biome) {
    if (!busy.add(player.getUniqueId())) {
      player.sendMessage(Messages.error("Already looking for a place."));
      return;
    }
    var world = destination(player, worldName, biome);
    if (world.isEmpty()) {
      release(player.getUniqueId());
      return;
    }
    player.sendMessage(Messages.info("Looking for a place..."));
    search.find(
        request(world.get(), biome), context.random(), spot -> found(player, world.get(), spot));
  }

  void moved(Player player) {
    warmups.moved(player);
  }

  void hurt(UUID player) {
    warmups.hurt(player);
  }

  private void found(Player player, World world, Optional<RtpSearch.Spot> spot) {
    if (!player.isOnline() || spot.isEmpty()) {
      release(player.getUniqueId());
      if (player.isOnline()) {
        player.sendMessage(Messages.error("Couldn't find a safe spot. Try again."));
      }
      return;
    }
    var at = spot.get();
    quote(player, new Location(world, at.x() + 0.5, at.y(), at.z() + 0.5));
  }

  private void quote(Player player, Location destination) {
    var now = context.time().instant();
    var _ =
        store
            .ensure(player.getUniqueId(), now)
            .whenCompleteAsync(
                (ensured, failure) -> quoted(player, destination, ensured, failure),
                context.scheduler().mainThread());
  }

  private void quoted(
      Player player,
      Location destination,
      com.shepherdjerred.thestorm.qol.app.Ensured ensured,
      Throwable failure) {
    if (failure != null || !player.isOnline()) {
      release(player.getUniqueId());
      context.logger().error("Could not price a random teleport", failure);
      return;
    }
    var decision =
        pricing.decide(
            ensured.profile().firstSeen(), ensured.profile().lastRtp(), context.time().instant());
    switch (decision) {
      case RtpDecision.CoolingDown(var remaining) -> {
        release(player.getUniqueId());
        player.sendMessage(
            Messages.error("You can teleport again in " + remaining.toSeconds() + "s."));
      }
      case RtpDecision.Free() -> stand(player, destination, 0);
      case RtpDecision.Priced(var cost) -> stand(player, destination, cost);
    }
  }

  private void stand(Player player, Location destination, long cost) {
    warmups.start(
        player,
        config.warmupDuration(),
        () -> arrive(player, destination, cost),
        () -> cancelled(player));
  }

  private void cancelled(Player player) {
    release(player.getUniqueId());
    if (player.isOnline()) {
      player.sendMessage(Messages.error("Teleport cancelled."));
    }
  }

  private void arrive(Player player, Location destination, long cost) {
    if (cost == 0) {
      finish(player, destination);
      return;
    }
    var _ =
        wallets
            .transfer(
                new AccountId.Player(player.getUniqueId()),
                new AccountId.Server(),
                Crystals.of(cost),
                "rtp")
            .whenCompleteAsync(
                (result, failure) -> paid(player, destination, new Charge(cost, result, failure)),
                context.scheduler().mainThread());
  }

  private void paid(Player player, Location destination, Charge charge) {
    var failure = charge.failure();
    var result = charge.result();
    var cost = charge.cost();
    if (failure != null || result == null) {
      release(player.getUniqueId());
      context.logger().error("Could not charge for a random teleport", failure);
      return;
    }
    switch (result) {
      case com.shepherdjerred.thestorm.core.result.Result.Ok<?, ?> ignored ->
          finish(player, destination);
      case com.shepherdjerred.thestorm.core.result.Result.Err<?, ?> ignored -> {
        release(player.getUniqueId());
        player.sendMessage(Messages.error("That costs " + cost + " crystals."));
      }
    }
  }

  private void finish(Player player, Location destination) {
    release(player.getUniqueId());
    if (!player.isOnline()) {
      return;
    }
    var world = destination.getWorld();
    if (world == null) {
      throw new IllegalStateException("teleport has no world");
    }
    player.teleport(destination);
    var now = context.time().instant();
    memory.remember(world.getName(), destination.getBlockX(), destination.getBlockZ(), now);
    var _ =
        store
            .setLastRtp(player.getUniqueId(), now)
            .whenCompleteAsync(
                (ok, failure) -> {
                  if (failure != null) {
                    context.logger().error("Could not record a random teleport", failure);
                  }
                },
                context.scheduler().mainThread());
    player.sendMessage(Messages.info("Teleported."));
  }

  private void release(UUID player) {
    busy.remove(player);
  }

  private Optional<World> destination(Player player, String worldName, Optional<String> biome) {
    var wild = worlds.named(worldName);
    if (wild.isEmpty() || !wild.get().rtp()) {
      player.sendMessage(Messages.error("That world is not open for a random teleport."));
      return Optional.empty();
    }
    if (biome.isPresent() && !config.biome(biome.get())) {
      player.sendMessage(Messages.error("Unknown biome " + biome.get() + "."));
      return Optional.empty();
    }
    var world = context.plugin().getServer().getWorld(worldName);
    if (world == null) {
      throw new IllegalStateException("random-teleport world " + worldName + " is not loaded");
    }
    return Optional.of(world);
  }

  private RtpSearch.Request request(World world, Optional<String> biome) {
    var spawn = world.getSpawnLocation();
    var border = world.getWorldBorder();
    var center = border.getCenter();
    var claims = land.chunks(world.getName());
    var repel = new ArrayList<>(centers(claims));
    repel.addAll(memory.points(world.getName(), context.time().instant()));
    if (claims.isEmpty()) {
      repel.add(new BlockPoint(spawn.getBlockX(), spawn.getBlockZ()));
    }
    return new RtpSearch.Request(
        new RtpSearch.Site(
            world,
            new BlockPoint(spawn.getBlockX(), spawn.getBlockZ()),
            new BlockPoint(center.getBlockX(), center.getBlockZ()),
            (int) border.getSize()),
        new RtpSearch.Target(biome, claims, repel));
  }

  private static java.util.List<BlockPoint> centers(java.util.List<SettledLand.Chunk> claims) {
    var centers = new ArrayList<BlockPoint>(claims.size());
    for (var claim : claims) {
      centers.add(new BlockPoint(claim.x() * 16 + 8, claim.z() * 16 + 8));
    }
    return centers;
  }

  /** Ports random teleport needs, already enabled. */
  record Ports(WildWorlds worlds, SettledLand land, QolStore store, Wallets wallets) {}

  private record Charge(
      long cost,
      com.shepherdjerred.thestorm.core.result.Result<
              com.shepherdjerred.thestorm.economy.app.Receipt,
              com.shepherdjerred.thestorm.economy.app.EconomyError>
          result,
      Throwable failure) {}
}
