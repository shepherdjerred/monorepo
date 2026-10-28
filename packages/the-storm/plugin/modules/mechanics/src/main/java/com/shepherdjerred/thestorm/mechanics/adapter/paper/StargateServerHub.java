package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.core.world.BlockChanges;
import com.shepherdjerred.thestorm.core.world.ChunkTickets;
import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.creative.app.CreativeEntry;
import com.shepherdjerred.thestorm.essentials.app.TeleportGuards;
import com.shepherdjerred.thestorm.essentials.app.TeleportTravel;
import com.shepherdjerred.thestorm.mechanics.app.StargateBook;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.NetworkAccess;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.ServerGate;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.Stargate;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.StargateFrame;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.StargateNetwork;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.BooleanSupplier;
import net.kyori.adventure.text.Component;
import org.bukkit.Axis;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.Sign;
import org.bukkit.block.data.Orientable;
import org.bukkit.block.sign.Side;
import org.bukkit.entity.Player;
import org.bukkit.event.Event;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockExplodeEvent;
import org.bukkit.event.block.BlockPistonExtendEvent;
import org.bukkit.event.block.BlockPistonRetractEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.block.SignChangeEvent;
import org.bukkit.event.entity.EntityExplodeEvent;
import org.bukkit.event.entity.EntityPortalEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerPortalEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.bukkit.event.world.ChunkLoadEvent;
import org.bukkit.inventory.EquipmentSlot;

/** Repository-owned sign-and-button gate to the four server worlds. */
final class StargateServerHub implements Listener {
  record Chunk(int x, int z) {}

  private record Hub(ServerGate config, Stargate gate, StargateNetwork network) {}

  private record Open(ServerGate.Destination destination, Cancellable closing, Set<Chunk> chunks) {}

  private final ModuleContext context;
  private final StargateBook book;
  private final Duration openFor;
  private final BooleanSupplier enabled;
  private final Protection protection;
  private final SealedWorlds sealed;
  private final BlockChanges blocks;
  private final ChunkTickets tickets;
  private final TeleportTravel travel;
  private final TeleportGuards guards;
  private final CreativeEntry creative;
  private final List<Hub> hubs;
  private final Map<UUID, Integer> selection = new HashMap<>();
  private final Map<UUID, Open> active = new HashMap<>();
  private final PendingGateTrips<Hub> trips = new PendingGateTrips<>();
  private final Set<UUID> inside = new HashSet<>();

  StargateServerHub(
      ModuleContext context,
      StargateBook book,
      StargateSettings settings,
      List<ServerGate> configs) {
    this.context = context;
    this.book = book;
    this.openFor = settings.openFor();
    this.enabled = settings.enabled();
    this.protection = context.services().require(Protection.class);
    this.sealed = context.services().require(SealedWorlds.class);
    this.blocks = context.services().require(BlockChanges.class);
    this.tickets = context.services().require(ChunkTickets.class);
    this.travel = context.services().require(TeleportTravel.class);
    this.guards = context.services().require(TeleportGuards.class);
    this.creative = context.services().require(CreativeEntry.class);
    this.guards.add(this::tripRefusal);
    this.hubs = configs.stream().map(this::resolve).toList();
    var occupied = new HashSet<String>();
    for (var hub : hubs) {
      for (var pos : cells(hub.gate())) {
        if (!occupied.add(hub.gate().worldId() + ":" + pos)) {
          throw new IllegalArgumentException("overlapping server Stargates at " + pos);
        }
      }
    }
  }

  private Hub resolve(ServerGate config) {
    var world = context.plugin().getServer().getWorld(config.world());
    if (world == null)
      throw new IllegalStateException("server Stargate world is not loaded: " + config.world());
    for (var destination : config.destinations()) {
      if (context.plugin().getServer().getWorld(destination.world()) == null) {
        throw new IllegalStateException(
            "server Stargate destination is not loaded: " + destination.world());
      }
      if (destination.kind() == ServerGate.Kind.CREATIVE) {
        var entry = creative.destination();
        if (!entry.getWorld().getName().equals(destination.world())
            || !PaperGrid.pos(entry).equals(destination.landing())) {
          throw new IllegalStateException(
              "server Stargate creative destination does not match creative entry");
        }
      }
    }
    var id =
        UUID.nameUUIDFromBytes(
            ("thestorm:server-gate:" + config.id()).getBytes(StandardCharsets.UTF_8));
    var network = new StargateNetwork(id, "Worlds", new NetworkAccess.Public());
    var gate =
        new Stargate(
            id,
            id,
            "World Gate",
            id,
            world.getUID(),
            config.sign(),
            new StargateFrame(config.origin(), config.across(), StargateFrame.Shape.CIRCLE),
            null,
            false);
    return new Hub(config, gate, network);
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void interact(PlayerInteractEvent event) {
    var block = event.getClickedBlock();
    if (block == null
        || event.getHand() != EquipmentSlot.HAND
        || event.getAction() != Action.RIGHT_CLICK_BLOCK) return;
    var found = atControl(block);
    if (found.isEmpty()) return;
    event.setUseInteractedBlock(Event.Result.DENY);
    event.setUseItemInHand(Event.Result.DENY);
    var hub = found.orElseThrow();
    var player = event.getPlayer();
    if (!enabled.getAsBoolean() || !book.ready()) {
      tell(player, "World travel is not available right now.");
      return;
    }
    if (sealed.isSealed(block.getWorld())) return;
    if (PaperGrid.pos(block).equals(hub.gate().sign())) select(player, hub);
    else activate(player, hub);
  }

  private void select(Player player, Hub hub) {
    if (active.containsKey(hub.gate().id())) {
      tell(player, "Wait for the gate to close before changing worlds.");
      return;
    }
    if (!intact(hub, false) || overlapsPlayerGate(hub)) {
      tell(player, "This world gate needs staff attention.");
      return;
    }
    var destinations = hub.config().destinations();
    var index =
        selection.containsKey(hub.gate().id())
            ? (selection.get(hub.gate().id()) + 1) % destinations.size()
            : 0;
    selection.put(hub.gate().id(), index);
    var name = destinations.get(index).label();
    var world = world(hub);
    var signBlock =
        world.getBlockAt(hub.gate().sign().x(), hub.gate().sign().y(), hub.gate().sign().z());
    if (!protection.isPreserved(signBlock.getLocation())
        && signBlock.getState() instanceof Sign sign) {
      sign.getSide(Side.FRONT).line(1, Component.text(name));
      sign.update();
    }
    tell(player, "Destination: " + name + ". Press the button to open the gate.");
  }

  private void activate(Player player, Hub hub) {
    if (active.containsKey(hub.gate().id())) return;
    var index = selection.get(hub.gate().id());
    if (index == null) {
      tell(player, "Choose a world on the sign first.");
      return;
    }
    if (!intact(hub, false) || overlapsPlayerGate(hub)) {
      tell(player, "This world gate needs staff attention.");
      return;
    }
    var grid = new PaperGrid(world(hub));
    if (!hub.config().allowPreservedPortal()
        && hub.gate().frame().interior().stream()
            .anyMatch(pos -> protection.isPreserved(grid.location(pos)))) {
      tell(player, "This world gate is in preserved land.");
      return;
    }
    var chunks = chunks(hub.gate());
    var held = new HashSet<Chunk>();
    try {
      for (var chunk : chunks) {
        tickets.hold(grid.world(), chunk.x(), chunk.z());
        held.add(chunk);
      }
      var portal = (Orientable) Material.NETHER_PORTAL.createBlockData();
      portal.setAxis(hub.gate().frame().across().dx() == 0 ? Axis.Z : Axis.X);
      var closing = context.scheduler().runOnMainThreadLater(openFor, () -> close(hub));
      try {
        blocks
            .prepare(
                "stargate",
                hub.gate().frame().interior().stream()
                    .map(pos -> new BlockChanges.Update(grid.block(pos), portal, false))
                    .toList())
            .apply();
        active.put(
            hub.gate().id(),
            new Open(hub.config().destinations().get(index), closing, Set.copyOf(held)));
      } catch (RuntimeException failure) {
        StargateActivation.abort(closing, () -> removePortal(hub, grid), failure);
        throw failure;
      }
    } catch (RuntimeException failure) {
      for (var chunk : held) tickets.release(grid.world(), chunk.x(), chunk.z());
      throw failure;
    }
    tell(player, "World gate open to " + hub.config().destinations().get(index).label() + ".");
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void move(PlayerMoveEvent event) {
    if (!event.hasChangedBlock()) return;
    enter(event.getPlayer(), event.getTo());
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void vehicleMove(org.bukkit.event.vehicle.VehicleMoveEvent event) {
    var vehicle = event.getVehicle();
    if (!StargateMount.supported(vehicle)) return;
    var position =
        StargateMount.touchingPortal(vehicle, event.getTo(), loc -> atInterior(loc).isPresent())
            .orElseGet(event::getTo);
    for (var passenger : vehicle.getPassengers())
      if (passenger instanceof Player player) enter(player, position);
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void mountMove(io.papermc.paper.event.entity.EntityMoveEvent event) {
    var mount = event.getEntity();
    if (!event.hasChangedPosition() || !StargateMount.supported(mount)) return;
    var position =
        StargateMount.touchingPortal(mount, event.getTo(), loc -> atInterior(loc).isPresent())
            .orElseGet(event::getTo);
    for (var passenger : mount.getPassengers())
      if (passenger instanceof Player player) enter(player, position);
  }

  private void enter(Player player, Location position) {
    var hub = atInterior(position);
    if (hub.isEmpty()) {
      inside.remove(player.getUniqueId());
      return;
    }
    if (!inside.add(player.getUniqueId()) || !enabled.getAsBoolean() || !book.ready()) return;
    var entry = active.get(hub.orElseThrow().gate().id());
    if (entry == null || !intact(hub.orElseThrow(), true)) return;
    if (entry.destination().kind() == ServerGate.Kind.CREATIVE) creative(player);
    else world(player, hub.orElseThrow(), entry.destination());
  }

  private void creative(Player player) {
    if (player.isInsideVehicle()) {
      tell(player, "Dismount before entering Creative.");
      return;
    }
    var location = creative.destination();
    var refusal = guards.check(player.getUniqueId(), location);
    if (refusal.isPresent()) {
      player.sendMessage(refusal.orElseThrow());
      return;
    }
    if (!protection
        .check(player.getUniqueId(), ProtectedAction.TELEPORT_INTO, location)
        .isAllowed()) {
      tell(player, "You cannot enter the creative world.");
      return;
    }
    creative.enter(player);
  }

  private void world(Player player, Hub hub, ServerGate.Destination destination) {
    var world = context.plugin().getServer().getWorld(destination.world());
    if (world == null) {
      tell(player, "That world is not loaded.");
      return;
    }
    var mount = player.getVehicle();
    if (mount != null && (!StargateMount.supported(mount) || mount.getPassengers().size() != 1)) {
      tell(player, "Dismount before using this Stargate.");
      return;
    }
    var target = new WorldTrip(world, destination, mount);
    travel.complimentary(player, destination.label(), () -> prepare(player, hub, target));
  }

  private record WorldTrip(
      World world,
      ServerGate.Destination destination,
      org.bukkit.entity.@org.jspecify.annotations.Nullable Entity mount) {}

  private CompletableFuture<Result<TeleportTravel.Landing, Component>> prepare(
      Player player, Hub hub, WorldTrip target) {
    var spawn = target.destination().landing();
    var world = target.world();
    var radius = StargateMount.landingRadius(player, target.mount());
    var chunks = landingChunks(spawn, radius);
    var id = player.getUniqueId();
    var trip = trips.start(id, hub);
    var loads =
        chunks.stream()
            .map(chunk -> world.getChunkAtAsync(chunk.x(), chunk.z()))
            .toArray(CompletableFuture<?>[]::new);
    return CompletableFuture.allOf(loads)
        .thenApplyAsync(
            ignored -> {
              var held = holdLanding(world, chunks);
              Runnable release =
                  () -> {
                    trips.finish(id, trip);
                    for (var chunk : held) tickets.release(world, chunk.x(), chunk.z());
                  };
              try {
                if (!player.isOnline()
                    || !enabled.getAsBoolean()
                    || !book.ready()
                    || !active.containsKey(hub.gate().id())
                    || !intact(hub, true)) {
                  release.run();
                  return Result.<TeleportTravel.Landing, Component>err(
                      Component.text("The world gate closed before travel."));
                }
                return Result.<TeleportTravel.Landing, Component>ok(
                    new TeleportTravel.Landing(
                        new Location(world, spawn.x() + 0.5, spawn.y(), spawn.z() + 0.5),
                        release,
                        () -> {},
                        StargateMount.transport(target.mount(), protection)));
              } catch (RuntimeException failure) {
                release.run();
                throw failure;
              }
            },
            context.scheduler().mainThread())
        .whenCompleteAsync(
            (result, failure) -> {
              if (failure != null) trips.finish(id, trip);
            },
            context.scheduler().mainThread());
  }

  static Set<Chunk> landingChunks(Pos spawn, int radius) {
    var chunks = new HashSet<Chunk>();
    for (var x = (spawn.x() - radius) >> 4; x <= (spawn.x() + radius) >> 4; x++) {
      for (var z = (spawn.z() - radius) >> 4; z <= (spawn.z() + radius) >> 4; z++) {
        chunks.add(new Chunk(x, z));
      }
    }
    return Set.copyOf(chunks);
  }

  private Set<Chunk> holdLanding(World world, Set<Chunk> chunks) {
    var held = new HashSet<Chunk>();
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

  private Optional<Component> tripRefusal(UUID playerId, Location destination) {
    var hub = trips.get(playerId);
    if (hub == null) return Optional.empty();
    if (!enabled.getAsBoolean()
        || !book.ready()
        || !active.containsKey(hub.gate().id())
        || !intact(hub, true)
        || overlapsPlayerGate(hub)) {
      return Optional.of(Component.text("The world gate changed before travel."));
    }
    return Optional.empty();
  }

  @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
  void playerPortal(PlayerPortalEvent event) {
    var vehicle = event.getPlayer().getVehicle();
    if (atInterior(event.getFrom()).isPresent()
        || atInterior(event.getFrom().clone().add(0, 1, 0)).isPresent()
        || (vehicle != null
            && StargateMount.touchingPortal(
                    vehicle, event.getFrom(), loc -> atInterior(loc).isPresent())
                .isPresent())) event.setCancelled(true);
  }

  @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
  void entityPortal(EntityPortalEvent event) {
    if (atInterior(event.getFrom()).isPresent()
        || atInterior(event.getFrom().clone().add(0, 1, 0)).isPresent()
        || StargateMount.touchingPortal(
                event.getEntity(), event.getFrom(), loc -> atInterior(loc).isPresent())
            .isPresent()) event.setCancelled(true);
  }

  @EventHandler
  void quit(PlayerQuitEvent event) {
    inside.remove(event.getPlayer().getUniqueId());
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void teleported(PlayerTeleportEvent event) {
    inside.remove(event.getPlayer().getUniqueId());
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void breaking(BlockBreakEvent event) {
    if (occupied(event.getBlock())) event.setCancelled(true);
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void placing(BlockPlaceEvent event) {
    if (occupied(event.getBlockPlaced())) event.setCancelled(true);
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void editing(SignChangeEvent event) {
    if (occupied(event.getBlock())) event.setCancelled(true);
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void explode(EntityExplodeEvent event) {
    event.blockList().removeIf(this::occupied);
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void explode(BlockExplodeEvent event) {
    event.blockList().removeIf(this::occupied);
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void extend(BlockPistonExtendEvent event) {
    if (moves(event.getBlocks(), event.getDirection())) event.setCancelled(true);
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void retract(BlockPistonRetractEvent event) {
    if (moves(event.getBlocks(), event.getDirection())) event.setCancelled(true);
  }

  private boolean moves(List<Block> moving, org.bukkit.block.BlockFace direction) {
    return moving.stream()
        .anyMatch(block -> occupied(block) || occupied(block.getRelative(direction)));
  }

  @EventHandler
  void chunkLoaded(ChunkLoadEvent event) {
    var chunk = event.getChunk();
    context
        .scheduler()
        .runOnMainThread(
            () ->
                hubs.stream()
                    .filter(hub -> hub.gate().worldId().equals(chunk.getWorld().getUID()))
                    .filter(
                        hub -> chunks(hub.gate()).contains(new Chunk(chunk.getX(), chunk.getZ())))
                    .forEach(this::recover));
  }

  void reconcileLoaded() {
    hubs.forEach(this::recover);
  }

  private void recover(Hub hub) {
    if (active.containsKey(hub.gate().id())) return;
    var grid = new PaperGrid(world(hub));
    if (StargateIntegrity.recoverable(grid, hub.gate(), hub.network())) removePortal(hub, grid);
  }

  private void close(Hub hub) {
    var open = active.remove(hub.gate().id());
    if (open == null) return;
    var world = world(hub);
    try {
      removePortal(hub, new PaperGrid(world));
    } finally {
      for (var chunk : open.chunks()) tickets.release(world, chunk.x(), chunk.z());
    }
  }

  private void removePortal(Hub hub, PaperGrid grid) {
    var portal =
        hub.gate().frame().interior().stream()
            .filter(pos -> grid.loaded(pos) && grid.cellAt(pos).is("minecraft:nether_portal"))
            .toList();
    if (portal.isEmpty()) return;
    if (!hub.config().allowPreservedPortal()
        && portal.stream().anyMatch(pos -> protection.isPreserved(grid.location(pos)))) {
      context.logger().error("World gate {} could not close in preserved land", hub.config().id());
      return;
    }
    var air = Material.AIR.createBlockData();
    blocks
        .prepare(
            "stargate",
            portal.stream()
                .map(pos -> new BlockChanges.Update(grid.block(pos), air, false))
                .toList())
        .apply();
  }

  void stop() {
    for (var hub : hubs) {
      var entry = active.get(hub.gate().id());
      if (entry != null) {
        entry.closing().cancel();
        close(hub);
      }
    }
  }

  private boolean intact(Hub hub, boolean open) {
    return StargateIntegrity.valid(new PaperGrid(world(hub)), hub.gate(), hub.network(), open);
  }

  private boolean overlapsPlayerGate(Hub hub) {
    return cells(hub.gate()).stream()
        .anyMatch(pos -> book.registry().occupied(hub.gate().worldId(), pos).isPresent());
  }

  private Optional<Hub> atControl(Block block) {
    var pos = PaperGrid.pos(block);
    return hubs.stream()
        .filter(
            hub ->
                hub.gate().worldId().equals(block.getWorld().getUID())
                    && (hub.gate().sign().equals(pos) || hub.gate().button().equals(pos)))
        .findFirst();
  }

  private Optional<Hub> atInterior(Location location) {
    var pos = PaperGrid.pos(location);
    return hubs.stream()
        .filter(
            hub ->
                hub.gate().worldId().equals(location.getWorld().getUID())
                    && hub.gate().frame().interior().contains(pos))
        .findFirst();
  }

  private boolean occupied(Block block) {
    var pos = PaperGrid.pos(block);
    return hubs.stream()
        .anyMatch(
            hub ->
                hub.gate().worldId().equals(block.getWorld().getUID())
                    && cells(hub.gate()).contains(pos));
  }

  private World world(Hub hub) {
    return java.util.Objects.requireNonNull(
        context.plugin().getServer().getWorld(hub.gate().worldId()));
  }

  private static Set<Pos> cells(Stargate gate) {
    var positions = new HashSet<>(gate.frame().frameBlocks());
    positions.addAll(gate.frame().interior());
    positions.add(gate.sign());
    positions.add(gate.button());
    return positions;
  }

  private static Set<Chunk> chunks(Stargate gate) {
    var chunks = new HashSet<Chunk>();
    cells(gate).forEach(pos -> chunks.add(new Chunk(pos.x() >> 4, pos.z() >> 4)));
    return chunks;
  }

  private static void tell(Player player, String message) {
    player.sendMessage(Component.text(message));
  }
}
