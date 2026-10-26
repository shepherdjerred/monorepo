package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.protection.SettledLand;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.core.world.ChunkTickets;
import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.essentials.app.TeleportTravel;
import com.shepherdjerred.thestorm.qol.app.LandingMemory;
import com.shepherdjerred.thestorm.qol.app.QolStore;
import com.shepherdjerred.thestorm.qol.domain.QolConfig;
import com.shepherdjerred.thestorm.qol.domain.rtp.BlockPoint;
import com.shepherdjerred.thestorm.world.app.WildWorlds;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickEvent;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.entity.Player;

/** RTP prepares a safe wilderness landing; Essentials owns all successful travel policy. */
final class RtpFlow {
  private final WildWorlds worlds;
  private final SettledLand land;
  private final QolStore store;
  private final LandingMemory memory;
  private final ModuleContext context;
  private final QolConfig config;
  private final RtpSearch search;
  private final ChunkTickets tickets;
  private final SealedWorlds sealed;
  private final TeleportTravel travel;
  private final StarterCompass compass;

  RtpFlow(Ports ports, ModuleContext context, QolConfig config, LandingMemory memory) {
    this.worlds = ports.worlds();
    this.land = ports.land();
    this.store = ports.store();
    this.memory = memory;
    this.context = context;
    this.config = config;
    this.compass = ports.compass();
    this.search = new RtpSearch(config, context.scheduler());
    this.tickets = context.services().require(ChunkTickets.class);
    this.sealed = context.services().require(SealedWorlds.class);
    this.travel = context.services().require(TeleportTravel.class);
  }

  void start(Player player, String worldName, Optional<String> biome) {
    start(player, worldName, biome, false);
  }

  void start(Player player, String worldName, Optional<String> biome, boolean fromCompass) {
    var world = destination(player, worldName, biome);
    world.ifPresent(
        target -> {
          var description = "wilderness in " + worldName;
          if (fromCompass) {
            travel.complimentary(player, description, () -> prepare(player, target, biome, true));
          } else {
            travel.randomTeleport(player, description, () -> prepare(player, target, biome, false));
          }
        });
  }

  private CompletableFuture<Result<TeleportTravel.Landing, Component>> prepare(
      Player player, World world, Optional<String> biome, boolean fromCompass) {
    if (fromCompass) {
      return search(player, world, biome, true);
    }
    return store
        .ensure(player.getUniqueId(), context.time().instant())
        .thenComposeAsync(
            ensured -> {
              var now = context.time().instant();
              var last = ensured.profile().lastRtp();
              if (last.isPresent()
                  && now.isBefore(last.orElseThrow().plus(config.searchIntervalDuration()))) {
                return CompletableFuture.completedFuture(
                    Result.err(Component.text("You can search again in a moment.")));
              }
              return search(player, world, biome, false);
            },
            context.scheduler().mainThread());
  }

  private CompletableFuture<Result<TeleportTravel.Landing, Component>> search(
      Player player, World world, Optional<String> biome, boolean fromCompass) {
    var result = new CompletableFuture<Result<TeleportTravel.Landing, Component>>();
    if (!player.isOnline()) {
      result.complete(Result.err(Component.text("You left before the search started.")));
      return result;
    }
    player.sendMessage(Messages.info("Looking for a place..."));
    search.find(
        request(world, biome),
        context.random(),
        outcome -> {
          try {
            completeSearch(new Attempt(player, world, fromCompass, result), outcome);
          } catch (RuntimeException failure) {
            result.completeExceptionally(failure);
          }
        });
    return result;
  }

  private record Attempt(
      Player player,
      World world,
      boolean fromCompass,
      CompletableFuture<Result<TeleportTravel.Landing, Component>> result) {}

  private void completeSearch(Attempt attempt, RtpSearch.Outcome outcome) {
    var player = attempt.player();
    var world = attempt.world();
    var result = attempt.result();
    if (outcome.failure() != null) {
      context.logger().error("Could not load chunks for random teleport", outcome.failure());
      result.complete(
          Result.err(Component.text("Could not load the destination. Try again later.")));
    } else if (!player.isOnline() || outcome.spot().isEmpty()) {
      result.complete(Result.err(Component.text("Couldn't find a safe spot. Try again.")));
    } else {
      var at = outcome.spot().orElseThrow();
      var destination = new Location(world, at.x() + 0.5, at.y(), at.z() + 0.5);
      var chunkX = destination.getBlockX() >> 4;
      var chunkZ = destination.getBlockZ() >> 4;
      tickets.hold(world, chunkX, chunkZ);
      result.complete(
          Result.ok(
              new TeleportTravel.Landing(
                  destination,
                  () -> tickets.release(world, chunkX, chunkZ),
                  () -> {
                    memory.remember(
                        world.getName(),
                        destination.getBlockX(),
                        destination.getBlockZ(),
                        context.time().instant());
                    if (attempt.fromCompass()) compass.arrived(player);
                    else {
                      var _ = store.setLastRtp(player.getUniqueId(), context.time().instant());
                    }
                    liveMap(player, destination);
                  })));
    }
  }

  private static void liveMap(Player player, Location destination) {
    if (!player.isOnline() || destination.getWorld() == null) return;
    var url =
        "https://bluemap.ts-mc.net/#"
            + destination.getWorld().getName()
            + ":"
            + destination.getBlockX()
            + ":"
            + destination.getBlockY()
            + ":"
            + destination.getBlockZ()
            + ":40:0:0";
    player.sendMessage(
        Component.text("LiveMap", NamedTextColor.AQUA).clickEvent(ClickEvent.openUrl(url)));
  }

  private Optional<World> destination(Player player, String worldName, Optional<String> biome) {
    if (sealed.isSealed(player.getWorld())) {
      player.sendMessage(Messages.error("You can't random teleport out of this world."));
      return Optional.empty();
    }
    var wild = worlds.named(worldName);
    if (wild.isEmpty() || !wild.orElseThrow().rtp() || sealed.isSealed(worldName)) {
      player.sendMessage(Messages.error("That world is not open for a random teleport."));
      return Optional.empty();
    }
    if (biome.isPresent() && !config.biome(biome.orElseThrow())) {
      player.sendMessage(Messages.error("Unknown biome " + biome.orElseThrow() + "."));
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
    context
        .services()
        .find(com.shepherdjerred.thestorm.essentials.app.RuntimeDestinations.class)
        .flatMap(destinations -> destinations.random(world.getName()))
        .ifPresent(
            origin -> {
              spawn.setX(origin.x());
              spawn.setY(origin.y());
              spawn.setZ(origin.z());
            });
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
            (int) border.getSize(),
            config.withinBorder(world.getName())),
        new RtpSearch.Target(biome, claims, repel));
  }

  private static List<BlockPoint> centers(List<SettledLand.Chunk> claims) {
    return claims.stream()
        .map(claim -> new BlockPoint(claim.x() * 16 + 8, claim.z() * 16 + 8))
        .toList();
  }

  record Ports(WildWorlds worlds, SettledLand land, QolStore store, StarterCompass compass) {}
}
