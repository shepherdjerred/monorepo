package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.core.world.ChunkTickets;
import com.shepherdjerred.thestorm.essentials.app.TeleportGuards;
import com.shepherdjerred.thestorm.essentials.app.TeleportTravel;
import com.shepherdjerred.thestorm.mechanics.app.StargateAccess;
import com.shepherdjerred.thestorm.mechanics.app.StargateBook;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Direction;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.Stargate;
import java.util.LinkedHashSet;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Predicate;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.entity.Player;

/** Free gate travel through Essentials' safety, land and teleport guard checks. */
final class StargateTravel {
  private record Chunk(int x, int z) {}

  private record Trip(UUID source, UUID target) {}

  private final ModuleContext context;
  private final StargateBook book;
  private final StargateAccess access;
  private final TeleportTravel travel;
  private final ChunkTickets tickets;
  private final Predicate<Stargate> open;
  private final PendingGateTrips<Trip> trips = new PendingGateTrips<>();

  StargateTravel(
      ModuleContext context, StargateBook book, StargateAccess access, Predicate<Stargate> open) {
    this.context = context;
    this.book = book;
    this.access = access;
    this.open = open;
    this.travel = context.services().require(TeleportTravel.class);
    this.tickets = context.services().require(ChunkTickets.class);
    context.services().require(TeleportGuards.class).add(this::refusal);
  }

  void go(Player player, Stargate source, Stargate target) {
    if (!book.ready() || !validAccess(player, source, target)) {
      player.sendMessage(Component.text("That Stargate destination is unavailable."));
      return;
    }
    var mount = player.getVehicle();
    if (mount != null && (!StargateMount.supported(mount) || mount.getPassengers().size() != 1)) {
      player.sendMessage(Component.text("Dismount before using this Stargate."));
      return;
    }
    travel.complimentary(player, target.name(), () -> prepare(player, source, target, mount));
  }

  private CompletableFuture<Result<TeleportTravel.Landing, Component>> prepare(
      Player player,
      Stargate source,
      Stargate target,
      org.bukkit.entity.@org.jspecify.annotations.Nullable Entity mount) {
    var world = context.plugin().getServer().getWorld(target.worldId());
    if (world == null)
      return CompletableFuture.completedFuture(
          Result.err(Component.text("The destination world is not loaded.")));
    var chunks = chunks(target, Math.max(1, StargateMount.landingRadius(player, mount)));
    var id = player.getUniqueId();
    var trip = trips.start(id, new Trip(source.id(), target.id()));
    var loads =
        chunks.stream()
            .map(chunk -> world.getChunkAtAsync(chunk.x(), chunk.z()))
            .toArray(CompletableFuture<?>[]::new);
    return CompletableFuture.allOf(loads)
        .thenApplyAsync(
            ignored -> {
              var held = hold(world, chunks);
              Runnable release =
                  () -> {
                    trips.finish(id, trip);
                    for (var chunk : held) tickets.release(world, chunk.x(), chunk.z());
                  };
              try {
                if (!player.isOnline()
                    || !book.ready()
                    || !validAccess(player, source, target)
                    || !open.test(source)
                    || !intact(target)) {
                  release.run();
                  return Result.<TeleportTravel.Landing, Component>err(
                      Component.text("The gate changed before travel."));
                }
                var feet = landing(target);
                if (mount != null) feet = feet.offset(target.facing());
                var location = new Location(world, feet.x() + 0.5, feet.y(), feet.z() + 0.5);
                return Result.<TeleportTravel.Landing, Component>ok(
                    new TeleportTravel.Landing(
                        location,
                        release,
                        () -> {},
                        StargateMount.transport(
                            mount,
                            context
                                .services()
                                .require(
                                    com.shepherdjerred.thestorm.core.protection.Protection
                                        .class))));
              } catch (RuntimeException failure) {
                release.run();
                throw failure;
              }
            },
            context.scheduler().mainThread())
        .whenCompleteAsync(
            (ignored, failure) -> {
              if (failure != null) trips.finish(id, trip);
            },
            context.scheduler().mainThread());
  }

  private java.util.List<Chunk> hold(World world, Set<Chunk> chunks) {
    var held = new java.util.ArrayList<Chunk>();
    try {
      for (var chunk : chunks) {
        tickets.hold(world, chunk.x(), chunk.z());
        held.add(chunk);
      }
      return held;
    } catch (RuntimeException failure) {
      for (var chunk : held) tickets.release(world, chunk.x(), chunk.z());
      throw failure;
    }
  }

  private Optional<Component> refusal(UUID playerId, Location destination) {
    var trip = trips.get(playerId);
    if (trip == null) return Optional.empty();
    var player = context.plugin().getServer().getPlayer(playerId);
    if (player == null || !book.ready())
      return Optional.of(Component.text("Stargates are unavailable."));
    var source = book.registry().gate(trip.source());
    var target = book.registry().gate(trip.target());
    if (source.isEmpty()
        || target.isEmpty()
        || !validAccess(player, source.orElseThrow(), target.orElseThrow())
        || !open.test(source.orElseThrow())
        || !intact(target.orElseThrow())) {
      return Optional.of(Component.text("The Stargate or your access changed."));
    }
    return Optional.empty();
  }

  private boolean validAccess(Player player, Stargate source, Stargate target) {
    var registry = book.registry();
    var sourceNow = registry.gate(source.id());
    var targetNow = registry.gate(target.id());
    if (sourceNow.isEmpty()
        || targetNow.isEmpty()
        || !sourceNow.orElseThrow().equals(source)
        || !targetNow.orElseThrow().equals(target)
        || !source.networkId().equals(target.networkId())) return false;
    var network = registry.network(source.networkId()).orElseThrow();
    return access.mayUse(player, network.access());
  }

  private boolean intact(Stargate gate) {
    World world = context.plugin().getServer().getWorld(gate.worldId());
    if (world == null) return false;
    var network = book.registry().network(gate.networkId()).orElseThrow();
    return StargateIntegrity.valid(new PaperGrid(world), gate, network, open.test(gate));
  }

  private static Pos landing(Stargate gate) {
    return gate.frame().origin().offset(Direction.UP).offset(gate.facing());
  }

  private static Set<Chunk> chunks(Stargate gate, int radius) {
    var positions = new LinkedHashSet<>(gate.frame().frameBlocks());
    positions.addAll(gate.frame().interior());
    positions.add(gate.sign());
    positions.add(gate.button());
    positions.add(landing(gate));
    var mountedLanding = landing(gate).offset(gate.facing());
    var result = new LinkedHashSet<Chunk>();
    positions.forEach(pos -> result.add(new Chunk(pos.x() >> 4, pos.z() >> 4)));
    for (var x = (mountedLanding.x() - radius) >> 4; x <= (mountedLanding.x() + radius) >> 4; x++) {
      for (var z = (mountedLanding.z() - radius) >> 4;
          z <= (mountedLanding.z() + radius) >> 4;
          z++) {
        result.add(new Chunk(x, z));
      }
    }
    return Set.copyOf(result);
  }
}
